"""Gemini 호출: 사진 1장 → OCR + 번역 + 구조화를 한 번에.

Vision API 를 따로 태우지 않는다. 손글씨 일본어 메뉴판에서 Gemini 멀티모달이 더 정확하고,
호출이 한 번이라 지연·비용·실패 지점이 모두 줄어든다.

호출은 두 종류다:
  - `extract_menu` — 사진 1장 → 전 항목의 **목록**. 출력이 항목 수만큼 곱해지므로 짧게.
  - `explain_item`  — 항목 1개 → 긴 설명·알레르기 근거. 텍스트 전용이라 싸고 빠르다.
자세한 배경은 app/schemas/menu.py 상단 참고.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import TypeVar

from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from pydantic import BaseModel

from app.core.config import Settings
from app.core.errors import (
    UnreadableMenu,
    UpstreamConfigError,
    UpstreamError,
    UpstreamRateLimited,
    UpstreamTimeout,
)
from app.schemas.menu import ExplainRequest, ItemExplanation, MenuExtraction
from app.services.image import PreparedImage

log = logging.getLogger(__name__)

# 재시도·폴백이 무의미한 상태 코드(키/권한/요청 자체가 잘못된 경우).
_NON_RETRYABLE = {400, 401, 403, 404}

_PROMPT_DIR = Path(__file__).resolve().parent.parent / "prompts"
_MENU_SCAN_PROMPT = (_PROMPT_DIR / "menu_scan.md").read_text(encoding="utf-8")
_ITEM_EXPLAIN_PROMPT = (_PROMPT_DIR / "item_explain.md").read_text(encoding="utf-8")

_MODE_HINT = {
    "poster": "벽에 붙은 벽보형 메뉴판입니다. 손글씨이거나 세로쓰기일 수 있습니다.",
    "booklet": "책자형 메뉴판입니다. 여러 단으로 나뉘어 있을 수 있습니다.",
    "kiosk": "키오스크/전광판 화면입니다. 사진·버튼과 글자가 섞여 있습니다.",
}

T = TypeVar("T", bound=BaseModel)


@dataclass(slots=True)
class Usage:
    """비용/지연을 판단할 수 있는 계측값.

    이 서비스의 지연은 거의 전부 '출력 토큰'에서 나온다. 로그에 남겨두면 메뉴가 큰
    사진에서 왜 느린지 추측하지 않아도 된다.
    """

    input_tokens: int = 0
    output_tokens: int = 0
    thought_tokens: int = 0


@dataclass(slots=True)
class ScanOutcome:
    extraction: MenuExtraction
    model: str
    usage: Usage


@dataclass(slots=True)
class ExplainOutcome:
    explanation: ItemExplanation
    model: str
    usage: Usage


class GeminiService:
    def __init__(self, settings: Settings):
        self._settings = settings
        api_key = settings.resolved_api_key
        if not api_key:
            raise RuntimeError(
                "GEMINI_API_KEY 가 설정되지 않았습니다. .env 또는 Cloud Run 시크릿을 확인하세요."
            )
        self._client = genai.Client(api_key=api_key)

    # --- 공개 API ------------------------------------------------------------

    async def extract_menu(
        self, image: PreparedImage, *, mode: str, models: list[str] | None = None
    ) -> ScanOutcome:
        """`models` 는 벤치마크 스크립트가 특정 모델만 강제할 때 쓴다."""

        async def call(model: str) -> ScanOutcome:
            hint = _MODE_HINT.get(mode, "")
            parsed, usage = await self._generate(
                model=model,
                contents=[
                    types.Part.from_bytes(data=image.data, mime_type=image.mime_type),
                    types.Part.from_text(text="이 메뉴판을 읽고 스키마대로 정리해 주세요."),
                ],
                system_instruction=(
                    f"{_MENU_SCAN_PROMPT}\n\n## 이번 사진에 대한 힌트\n\n{hint}".strip()
                ),
                schema=MenuExtraction,
                with_media=True,
            )
            if not parsed.items:
                raise UnreadableMenu(detail=f"empty items model={model}")
            return ScanOutcome(extraction=parsed, model=model, usage=usage)

        return await self._with_fallback(call, models)

    async def explain_item(
        self, req: ExplainRequest, *, models: list[str] | None = None
    ) -> ExplainOutcome:
        """항목 1개의 상세 설명. 사진을 보내지 않으므로 목록 호출보다 훨씬 싸고 빠르다."""

        async def call(model: str) -> ExplainOutcome:
            context = [f"메뉴 원문: {req.name_local}", f"메뉴판 언어: {req.source_lang}"]
            if req.name_translated:
                context.append(f"한국어 번역명: {req.name_translated}")
            if req.cuisine_hint:
                context.append(f"가게 성격: {req.cuisine_hint}")

            parsed, usage = await self._generate(
                model=model,
                contents=[types.Part.from_text(text="\n".join(context))],
                system_instruction=_ITEM_EXPLAIN_PROMPT,
                schema=ItemExplanation,
                with_media=False,
            )
            if not parsed.description.strip():
                raise UnreadableMenu(detail=f"empty description model={model}")
            return ExplainOutcome(explanation=parsed, model=model, usage=usage)

        return await self._with_fallback(call, models)

    # --- 내부 ---------------------------------------------------------------

    async def _with_fallback(
        self, call: Callable[[str], Awaitable[T]], models: list[str] | None
    ) -> T:
        """1차 모델로 재시도한 뒤 폴백 모델로 넘어간다.

        1차를 싼 모델로 두면 이 구조가 그대로 "싸게 먼저, 안 되면 좋은 걸로" 에스컬레이션이 된다.
        """
        models = models or [self._settings.gemini_model, self._settings.gemini_model_fallback]
        last_error: Exception | None = None

        for model in models:
            for attempt in range(1, self._settings.gemini_max_attempts + 1):
                try:
                    return await call(model)
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

    def _config(
        self, *, system_instruction: str, schema: type[BaseModel], with_media: bool
    ) -> types.GenerateContentConfig:
        kwargs: dict = {
            "system_instruction": system_instruction,
            # 구조화 출력: Pydantic 클래스를 그대로 넘길 수 있다.
            "response_mime_type": "application/json",
            "response_schema": schema,
            # Gemini 3 의 thinking_level 기본값은 HIGH 다. 명시하지 않으면 지연이 2~4배가 되고
            # thinking 토큰이 '출력' 단가로 과금된다. (thinking_budget 과 동시 지정하면 400)
            "thinking_config": types.ThinkingConfig(
                thinking_level=self._settings.gemini_thinking_level.upper()
            ),
            "temperature": 0.2,
        }
        # 사진이 없는 호출에 media_resolution 을 붙일 이유가 없다. 지원하지 않는 모델에
        # 보내면 400 이므로 빈 값이면 아예 넣지 않는다.
        if with_media and self._settings.gemini_media_resolution:
            kwargs["media_resolution"] = self._settings.gemini_media_resolution
        return types.GenerateContentConfig(**kwargs)

    async def _generate(
        self,
        *,
        model: str,
        contents: list[types.Part],
        system_instruction: str,
        schema: type[T],
        with_media: bool,
    ) -> tuple[T, Usage]:
        try:
            resp = await asyncio.wait_for(
                self._client.aio.models.generate_content(
                    model=model,
                    contents=contents,
                    config=self._config(
                        system_instruction=system_instruction,
                        schema=schema,
                        with_media=with_media,
                    ),
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
        if not isinstance(parsed, schema):
            raise UnreadableMenu(
                detail=f"parsed=None model={model} text_head={(resp.text or '')[:200]!r}"
            )

        # 계측값은 있으면 좋은 것이지 없다고 요청을 실패시킬 이유는 아니다.
        meta = getattr(resp, "usage_metadata", None)
        usage = Usage(
            input_tokens=getattr(meta, "prompt_token_count", 0) or 0,
            output_tokens=getattr(meta, "candidates_token_count", 0) or 0,
            thought_tokens=getattr(meta, "thoughts_token_count", 0) or 0,
        )
        return parsed, usage
