"""GeminiService 의 재시도·폴백·파싱 실패 처리."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from google.genai import errors as genai_errors

from app.core.config import Settings
from app.core.errors import UnreadableMenu, UpstreamConfigError, UpstreamRateLimited
from app.schemas.menu import MenuExtraction
from app.services.gemini import GeminiService
from app.services.image import PreparedImage
from tests.conftest import sample_extraction

IMAGE = PreparedImage(b"jpeg-bytes", "image/jpeg", 2048, 1536)


def build_service(responses: list) -> tuple[GeminiService, list[str]]:
    """`responses` 를 순서대로 돌려주는(또는 raise 하는) 가짜 SDK 를 물린 서비스."""
    settings = Settings(gemini_api_key="test-key", gemini_max_attempts=2)
    service = GeminiService(settings)
    used_models: list[str] = []
    queue = list(responses)

    async def fake_generate_content(*, model: str, contents, config):  # noqa: ARG001
        used_models.append(model)
        item = queue.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    service._client = SimpleNamespace(  # type: ignore[assignment]
        aio=SimpleNamespace(models=SimpleNamespace(generate_content=fake_generate_content))
    )
    return service, used_models


def ok_response(extraction: MenuExtraction | None) -> SimpleNamespace:
    return SimpleNamespace(parsed=extraction, text="{}" if extraction is None else "")


def api_error(code: int) -> genai_errors.APIError:
    return genai_errors.APIError(code, {"error": {"code": code, "message": "boom"}})


async def test_returns_extraction_and_model():
    service, used = build_service([ok_response(sample_extraction())])
    extraction, model = await service.extract_menu(IMAGE, mode="poster")
    assert extraction.items[0].name_local == "ラフテー"
    assert model == used[0]


async def test_parsed_none_is_retried_then_falls_back_to_second_model():
    """`resp.parsed` 는 스키마 위반 시 예외 없이 None 이 된다. 이 분기가 빠지면
    '메뉴 0개'가 조용히 사용자에게 나간다."""
    service, used = build_service(
        [ok_response(None), ok_response(None), ok_response(sample_extraction())]
    )
    extraction, model = await service.extract_menu(IMAGE, mode="poster")
    assert extraction.items
    assert used[:2] == [used[0], used[0]]  # 1차 모델로 2번
    assert model == used[2] != used[0]  # 그 다음 폴백 모델


async def test_all_attempts_failing_raises_unreadable_menu():
    service, used = build_service([ok_response(None)] * 4)
    with pytest.raises(UnreadableMenu):
        await service.extract_menu(IMAGE, mode="poster")
    assert len(used) == 4  # 모델 2개 × 시도 2회


async def test_empty_items_is_treated_as_unreadable():
    empty = sample_extraction().model_copy(update={"items": []})
    service, _ = build_service([ok_response(empty)] * 4)
    with pytest.raises(UnreadableMenu):
        await service.extract_menu(IMAGE, mode="poster")


async def test_bad_api_key_fails_fast_without_retrying():
    """잘못된 키로 4번 호출하지 않는다."""
    service, used = build_service([api_error(400)])
    with pytest.raises(UpstreamConfigError):
        await service.extract_menu(IMAGE, mode="poster")
    assert len(used) == 1


async def test_rate_limit_is_not_retried():
    service, used = build_service([api_error(429)])
    with pytest.raises(UpstreamRateLimited):
        await service.extract_menu(IMAGE, mode="poster")
    assert len(used) == 1


async def test_server_error_is_retried():
    service, used = build_service([api_error(503), ok_response(sample_extraction())])
    extraction, _ = await service.extract_menu(IMAGE, mode="poster")
    assert extraction.items
    assert len(used) == 2
