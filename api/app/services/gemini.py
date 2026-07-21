"""Gemini 원샷 호출: 사진 1장 → OCR + 번역 + 구조화를 한 번에.

Vision API 를 따로 태우지 않는다. 손글씨 일본어 메뉴판에서 Gemini 멀티모달이 더 정확하고,
호출이 한 번이라 지연·비용·실패 지점이 모두 줄어든다.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from app.core.config import Settings
from app.core.errors import (
    UnreadableMenu,
    UpstreamConfigError,
    UpstreamError,
    UpstreamRateLimited,
    UpstreamTimeout,
)
from app.schemas.menu import MenuExtraction
from app.services.image import PreparedImage

log = logging.getLogger(__name__)

# 재시도·폴백이 무의미한 상태 코드(키/권한/요청 자체가 잘못된 경우).
_NON_RETRYABLE = {400, 401, 403, 404}

_PROMPT_DIR = Path(__file__).resolve().parent.parent / "prompts"
_MENU_SCAN_PROMPT = (_PROMPT_DIR / "menu_scan.md").read_text(encoding="utf-8")

_MODE_HINT = {
    "poster": "벽에 붙은 벽보형 메뉴판입니다. 손글씨이거나 세로쓰기일 수 있습니다.",
    "booklet": "책자형 메뉴판입니다. 여러 단으로 나뉘어 있을 수 있습니다.",
    "kiosk": "키오스크/전광판 화면입니다. 사진·버튼과 글자가 섞여 있습니다.",
}


class GeminiService:
    def __init__(self, settings: Settings):
        self._settings = settings
        api_key = settings.resolved_api_key
        if not api_key:
            raise RuntimeError(
                "GEMINI_API_KEY 가 설정되지 않았습니다. .env 또는 Cloud Run 시크릿을 확인하세요."
            )
        self._client = genai.Client(api_key=api_key)

    def _config(self, mode: str) -> types.GenerateContentConfig:
        hint = _MODE_HINT.get(mode, "")
        return types.GenerateContentConfig(
            system_instruction=f"{_MENU_SCAN_PROMPT}\n\n## 이번 사진에 대한 힌트\n\n{hint}".strip(),
            # 구조화 출력: Pydantic 클래스를 그대로 넘길 수 있다.
            response_mime_type="application/json",
            response_schema=MenuExtraction,
            # Gemini 3 의 thinking_level 기본값은 HIGH 다. 명시하지 않으면 지연이 2~4배가 되고
            # thinking 토큰이 '출력' 단가로 과금된다. (thinking_budget 과 동시 지정하면 400)
            thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW),
            # 문서는 "일반 문서는 medium 에서 포화"라고 하지만 손글씨 벽보는 예외다.
            media_resolution=self._settings.gemini_media_resolution,
            temperature=0.2,
        )

    async def extract_menu(self, image: PreparedImage, *, mode: str) -> tuple[MenuExtraction, str]:
        """(추출 결과, 실제로 사용한 모델 ID) 를 반환한다."""
        models = [self._settings.gemini_model, self._settings.gemini_model_fallback]
        last_error: Exception | None = None

        for model in models:
            for attempt in range(1, self._settings.gemini_max_attempts + 1):
                try:
                    return await self._call(model, image, mode), model
                except (UpstreamTimeout, UpstreamRateLimited, UpstreamConfigError):
                    raise  # 재시도해도 나아지지 않는다. 즉시 사용자에게.
                except (UnreadableMenu, UpstreamError) as exc:
                    last_error = exc
                    log.warning(
                        "gemini call failed model=%s attempt=%d/%d err=%s",
                        model, attempt, self._settings.gemini_max_attempts, exc,
                    )
                    if attempt < self._settings.gemini_max_attempts:
                        await asyncio.sleep(0.6 * attempt)

        raise last_error or UpstreamError()

    async def _call(self, model: str, image: PreparedImage, mode: str) -> MenuExtraction:
        contents = [
            types.Part.from_bytes(data=image.data, mime_type=image.mime_type),
            types.Part.from_text(text="이 메뉴판을 읽고 스키마대로 정리해 주세요."),
        ]
        try:
            resp = await asyncio.wait_for(
                self._client.aio.models.generate_content(
                    model=model, contents=contents, config=self._config(mode)
                ),
                timeout=self._settings.gemini_timeout_s,
            )
        except TimeoutError as exc:
            raise UpstreamTimeout(detail=f"model={model}") from exc
        except genai_errors.APIError as exc:
            status = getattr(exc, "code", None) or getattr(exc, "status", None)
            if status == 429:
                raise UpstreamRateLimited(detail=str(exc)) from exc
            if status in _NON_RETRYABLE:
                # 키가 틀렸거나 요청이 잘못된 것. 재시도해도 똑같이 실패하므로 폴백 모델로도
                # 넘기지 않는다. (스모크 테스트에서 잘못된 키 하나가 4번 호출되는 걸 발견)
                raise UpstreamConfigError(detail=f"{status}: {exc}") from exc
            raise UpstreamError(detail=f"{status}: {exc}") from exc

        # ⚠️ resp.parsed 는 절대 예외를 던지지 않는다. SDK 가 ValidationError/JSONDecodeError 를
        # 조용히 삼키고 None 을 준다. 이 분기가 없으면 '메뉴 0개'가 그냥 나간다.
        parsed = resp.parsed
        if not isinstance(parsed, MenuExtraction):
            raise UnreadableMenu(
                detail=f"parsed=None model={model} text_head={(resp.text or '')[:200]!r}"
            )
        if not parsed.items:
            raise UnreadableMenu(detail=f"empty items model={model}")
        return parsed
