#!/usr/bin/env python
"""이 API 키로 실제로 쓸 수 있는 모델이 뭔지 확인한다.

    uv run python scripts/probe_models.py

모델 목록은 문서보다 빨리 바뀌고, 문서에 GA 로 적혀 있어도 503(overloaded)이 계속
나면 폴백으로 쓸 수 없다. 실제로 gemini-3.5-flash 가 그랬다 — 배포 전 한 번 돌려볼 것.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from google import genai  # noqa: E402
from google.genai import types  # noqa: E402

from app.core.config import Settings  # noqa: E402

CANDIDATES = [
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash-lite",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3-flash-preview",
]


async def main() -> int:
    settings = Settings()
    if not settings.resolved_api_key:
        print("❌ GEMINI_API_KEY 가 없습니다. api/.env 를 확인하세요.", file=sys.stderr)
        return 1

    client = genai.Client(api_key=settings.resolved_api_key)
    config = types.GenerateContentConfig(
        thinking_config=types.ThinkingConfig(thinking_level="LOW")
    )

    print(f"현재 설정 → 1차: {settings.gemini_model} / 폴백: {settings.gemini_model_fallback}\n")
    alive = []
    for model in CANDIDATES:
        try:
            await asyncio.wait_for(
                client.aio.models.generate_content(model=model, contents="ping", config=config),
                timeout=30,
            )
            print(f"  ✅ {model}")
            alive.append(model)
        except Exception as exc:  # noqa: BLE001 — 어떤 실패든 '못 쓴다'로 취급한다
            print(f"  ❌ {model}  {str(exc)[:80]}")

    print()
    for role, model in (("1차", settings.gemini_model), ("폴백", settings.gemini_model_fallback)):
        if model not in alive:
            print(f"⚠️  {role} 모델 {model} 이 응답하지 않습니다. 설정을 바꾸세요.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
