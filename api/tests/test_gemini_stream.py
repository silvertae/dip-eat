"""`GeminiService.stream_menu` / `_stream_items` — 스트리밍 경로의 실제 동작.

⚠️ 이 파일이 왜 필요한가: `tests/test_scan_stream_route.py` 는 `conftest.FakeGemini.stream_menu`
(이벤트를 직접 yield 하는 손수 만든 제너레이터)만 태우고, `test_gemini_service.py` 는
`generate_content` 만 스텁한다. 그래서 `_stream_items` 는 **한 줄도 실행되지 않았다** —
AGENTS.md 가 "`response.parsed` 가드의 대체물" 이라고 못 박은 `count == 0 → UnreadableMenu`
까지 포함해서. 스트리밍 타임아웃 누락과 잘림 미감지가 그동안 안 보였던 이유가 이것이다.

여기서는 진짜 `MenuStreamParser` 를 태우려고 **실제 JSON 문자열을 조각내서** 먹인다.
"""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest
from google.genai import errors as genai_errors

from app.core.config import Settings
from app.core.errors import (
    UnreadableMenu,
    UpstreamConfigError,
    UpstreamError,
    UpstreamRateLimited,
    UpstreamTimeout,
)
from app.schemas.menu import MenuItemSummary
from app.services.gemini import GeminiService, ScanHead, ScanTail
from app.services.image import PreparedImage
from tests.conftest import sample_extraction

IMAGE = PreparedImage(b"jpeg-bytes", "image/jpeg", 2048, 1536)


def full_json(items: int = 2, warnings: list[str] | None = None) -> str:
    """실제 응답과 같은 모양의 완결 JSON. 항목 이름만 다르게 복제한다."""
    base = sample_extraction()
    one = base.items[0]
    base = base.model_copy(
        update={
            "items": [one.model_copy(update={"name_local": f"품목{i}"}) for i in range(items)],
            "warnings": warnings or [],
        }
    )
    return base.model_dump_json()


def slice_every(text: str, n: int = 7) -> list[str]:
    """조각 경계가 어디 떨어져도 결과가 같아야 한다 — 일부러 잘게 썬다."""
    return [text[i : i + n] for i in range(0, len(text), n)]


def chunk(text: str, *, usage: bool = False) -> SimpleNamespace:
    meta = (
        SimpleNamespace(prompt_token_count=1900, candidates_token_count=430, thoughts_token_count=0)
        if usage
        else None
    )
    return SimpleNamespace(text=text, usage_metadata=meta)


def build_streaming_service(scripts: list, **settings_kwargs) -> tuple[GeminiService, list[str]]:
    """모델 호출마다 `scripts` 에서 하나씩 꺼내 쓴다.

    각 항목은 다음 중 하나:
      - `list[str]`  : 그 조각들을 순서대로 흘린다
      - `Exception`  : 스트림을 **만들 때** 즉시 raise (첫 토큰 전 실패)
      - `(list[str], Exception)` : 조각을 좀 흘리다가 도중에 raise
    """
    settings = Settings(gemini_api_key="test-key", gemini_max_attempts=2, **settings_kwargs)
    service = GeminiService(settings)
    used_models: list[str] = []
    queue = list(scripts)

    async def fake_stream(*, model: str, contents, config):
        used_models.append(model)
        script = queue.pop(0)
        if isinstance(script, Exception):
            raise script
        pieces, boom = script if isinstance(script, tuple) else (script, None)

        async def gen():
            for i, piece in enumerate(pieces):
                yield chunk(piece, usage=(i == len(pieces) - 1))
            if boom is not None:
                raise boom

        return gen()

    service._client = SimpleNamespace(  # type: ignore[assignment]
        aio=SimpleNamespace(models=SimpleNamespace(generate_content_stream=fake_stream))
    )
    return service, used_models


async def collect(service: GeminiService) -> list:
    return [ev async for ev in service.stream_menu(IMAGE, mode="poster")]


# --- 정상 경로 ---------------------------------------------------------------


async def test_chunked_json_produces_head_items_tail():
    service, _ = build_streaming_service([slice_every(full_json(items=3))])
    events = await collect(service)

    assert isinstance(events[0], ScanHead)
    assert events[0].source_lang == "ja"
    assert events[0].currency == "JPY"
    assert events[0].restaurant.name_local == "ゆうなんぎい"

    items = [e for e in events if isinstance(e, MenuItemSummary)]
    assert [i.name_local for i in items] == ["품목0", "품목1", "품목2"]

    tail = events[-1]
    assert isinstance(tail, ScanTail)
    assert tail.items == 3
    assert tail.usage.output_tokens == 430


async def test_warnings_survive_the_tail_reparse():
    service, _ = build_streaming_service([slice_every(full_json(warnings=["가격이 흐릿해요"]))])
    tail = (await collect(service))[-1]
    assert isinstance(tail, ScanTail)
    assert tail.warnings == ["가격이 흐릿해요"]


# --- 가드 --------------------------------------------------------------------


async def test_zero_items_raises_unreadable_menu():
    """AGENTS.md 가 지정한 `response.parsed` 가드의 대체물. 이게 없으면 '메뉴 0개'가 조용히 나간다."""
    empty = slice_every(json.dumps({"source_lang": "ja", "currency": "JPY", "items": []}))
    service, used = build_streaming_service([empty, empty, empty, empty])
    with pytest.raises(UnreadableMenu):
        await collect(service)
    assert len(used) == 2  # 모델 2개. 스트리밍은 모델당 1회다(_with_fallback 을 안 탄다)


async def test_schema_violating_item_is_dropped_but_the_rest_survive():
    good = full_json(items=2)
    # 첫 항목의 category 를 스키마에 없는 값으로 바꾼다 — 그 항목만 버려져야 한다.
    broken = good.replace('"category":"food"', '"category":"우주식량"', 1)
    service, _ = build_streaming_service([slice_every(broken)])
    items = [e for e in await collect(service) if isinstance(e, MenuItemSummary)]
    assert [i.name_local for i in items] == ["품목1"]


async def test_truncated_stream_is_reported_as_a_warning_not_as_success():
    """MAX_TOKENS 로 끊기면 items 배열이 안 닫힌다. 경고 없이 done 이 나가면
    사용자는 61/90 을 '완전한 메뉴'로 본다."""
    truncated = full_json(items=3)
    truncated = truncated[: truncated.index("품목2") - 20]  # 마지막 항목 중간에서 절단
    service, _ = build_streaming_service([slice_every(truncated)])
    events = await collect(service)

    tail = events[-1]
    assert isinstance(tail, ScanTail)
    assert tail.items >= 1
    assert any("일부만" in w for w in tail.warnings)


async def test_complete_stream_has_no_truncation_warning():
    service, _ = build_streaming_service([slice_every(full_json(items=2))])
    tail = (await collect(service))[-1]
    assert isinstance(tail, ScanTail)
    assert tail.warnings == []


# --- 폴백 --------------------------------------------------------------------


async def test_failure_before_first_item_falls_back_without_duplicating_items():
    """첫 항목 전에는 아무것도 내보내지 않는다 — 그래야 모델을 바꿔도 항목이 겹치지 않는다."""
    service, used = build_streaming_service(
        [genai_errors.APIError(503, {"error": {"code": 503}}), slice_every(full_json(items=2))]
    )
    events = await collect(service)
    items = [e for e in events if isinstance(e, MenuItemSummary)]

    assert [i.name_local for i in items] == ["품목0", "품목1"]  # 중복 없음
    assert len(used) == 2 and used[0] != used[1]
    assert isinstance(events[0], ScanHead) and events[0].model == used[1]


async def test_bad_key_does_not_escalate_to_the_fallback_model():
    service, used = build_streaming_service([genai_errors.APIError(400, {"error": {"code": 400}})])
    with pytest.raises(UpstreamConfigError):
        await collect(service)
    assert len(used) == 1


async def test_rate_limit_does_not_escalate_to_the_fallback_model():
    service, used = build_streaming_service([genai_errors.APIError(429, {"error": {"code": 429}})])
    with pytest.raises(UpstreamRateLimited):
        await collect(service)
    assert len(used) == 1


# --- 타임아웃·전송 오류 -------------------------------------------------------


async def test_stalled_stream_times_out_instead_of_hanging_forever():
    """⚠️ `asyncio.wait_for` 가 감싸는 건 스트림 객체를 '만드는' 코루틴뿐이다.
    청크 반복을 안 감싸면 Gemini 가 헤더만 보내고 멈췄을 때 Cloud Run 이 소켓을
    자를 때까지(105초) concurrency 슬롯을 붙잡고, 폴백 모델은 시도조차 안 된다."""
    settings = Settings(gemini_api_key="test-key", gemini_stream_idle_s=0.05)
    service = GeminiService(settings)
    used: list[str] = []

    async def stalling_stream(*, model: str, contents, config):
        used.append(model)

        async def gen():
            await asyncio.sleep(30)  # 영원히 안 오는 첫 청크
            yield chunk("{}")

        return gen()

    service._client = SimpleNamespace(  # type: ignore[assignment]
        aio=SimpleNamespace(models=SimpleNamespace(generate_content_stream=stalling_stream))
    )

    with pytest.raises(UpstreamTimeout):
        await asyncio.wait_for(collect(service), timeout=5)
    assert len(used) == 2  # 멈춘 모델을 포기하고 폴백까지 시도했다


async def test_transport_error_is_mapped_and_still_falls_back():
    """httpx 예외는 SDK 의 APIError 가 아니다. 매핑하지 않으면 `_with_fallback` 의
    `except (UnreadableMenu, UpstreamError)` 에 안 걸려 재시도도 폴백도 안 돈다."""
    service, used = build_streaming_service(
        [httpx.ConnectError("dns"), slice_every(full_json(items=1))]
    )
    items = [e for e in await collect(service) if isinstance(e, MenuItemSummary)]
    assert len(items) == 1
    assert len(used) == 2


async def test_read_timeout_maps_to_upstream_timeout():
    service, _ = build_streaming_service([httpx.ReadTimeout("slow"), httpx.ReadTimeout("slow")])
    with pytest.raises(UpstreamTimeout):
        await collect(service)


async def test_transport_error_after_first_item_surfaces_as_upstream_error():
    """이미 항목을 보낸 뒤라 폴백은 불가능하다 — 라우트가 error 줄로 바꿀 수 있게 매핑만 한다."""
    pieces = slice_every(full_json(items=2))
    service, _ = build_streaming_service(
        [(pieces[: len(pieces) // 2], httpx.RemoteProtocolError("reset"))] * 2
    )
    with pytest.raises(UpstreamError):
        await collect(service)
