"""`/menu/scan/stream` 라우트 계약 테스트.

이 엔드포인트의 함정: **HTTP 상태가 항상 200 이다.** 첫 바이트를 보내는 순간 상태 코드가
확정되므로 생성 도중 난 오류를 4xx/5xx 로 못 바꾼다. 그래서 오류도 본문 안에 들어가고,
클라이언트는 상태가 아니라 `type` 을 봐야 한다. 아래 테스트가 그 계약을 고정한다.
"""

from __future__ import annotations

import json

from app.core.errors import UnreadableMenu, UpstreamTimeout
from tests.conftest import FakeGemini, make_jpeg


def events(body: str) -> list[dict]:
    return [json.loads(line) for line in body.splitlines() if line.strip()]


async def test_emits_meta_then_items_then_done(client_factory):
    async with client_factory() as client:
        resp = await client.post(
            "/api/v1/menu/scan/stream",
            files={"image": ("m.jpg", make_jpeg(), "image/jpeg")},
            data={"mode": "poster"},
        )

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/x-ndjson")
    # 프록시 버퍼링 방지 헤더가 빠지면 스트리밍이 무의미해진다.
    assert resp.headers["x-accel-buffering"] == "no"

    kinds = [e["type"] for e in events(resp.text)]
    assert kinds[0] == "meta"
    assert kinds[-1] == "done"
    assert set(kinds[1:-1]) == {"item"}


async def test_meta_carries_what_the_screen_needs_before_any_item(client_factory):
    """가게 이름·통화가 첫 줄에 와야 카드보다 먼저 헤더를 그린다."""
    async with client_factory() as client:
        resp = await client.post(
            "/api/v1/menu/scan/stream",
            files={"image": ("m.jpg", make_jpeg(), "image/jpeg")},
        )

    meta = events(resp.text)[0]
    assert meta["source_lang"] == "ja"
    assert meta["currency"] == "JPY"
    assert meta["restaurant"]["name_local"]
    assert len(meta["scan_id"]) == 32  # uuid4().hex


async def test_items_match_the_non_streaming_endpoint(client_factory):
    """두 엔드포인트가 같은 결과를 줘야 한다 — 스트리밍은 전달 방식만 다르다."""
    async with client_factory() as client:
        streamed = await client.post(
            "/api/v1/menu/scan/stream", files={"image": ("m.jpg", make_jpeg(), "image/jpeg")}
        )
        plain = await client.post(
            "/api/v1/menu/scan", files={"image": ("m.jpg", make_jpeg(), "image/jpeg")}
        )

    from_stream = [e["item"] for e in events(streamed.text) if e["type"] == "item"]
    assert from_stream == plain.json()["items"]


async def test_done_carries_warnings_and_meta(client_factory):
    """warnings 는 스키마상 items 뒤에 오므로 done 에서만 알 수 있다."""
    async with client_factory() as client:
        resp = await client.post(
            "/api/v1/menu/scan/stream", files={"image": ("m.jpg", make_jpeg(), "image/jpeg")}
        )

    done = events(resp.text)[-1]
    assert done["type"] == "done"
    assert isinstance(done["warnings"], list)
    assert done["meta"]["model"] == "fake-model"
    assert done["meta"]["latency_ms"] >= 0
    assert done["meta"]["image_px"]


async def test_failure_before_the_first_item_is_an_error_line_not_a_500(client_factory):
    """스트림은 이미 200 으로 시작했다. 오류는 본문으로 와야 한다."""
    fake = FakeGemini(error=UpstreamTimeout())
    async with client_factory(fake) as client:
        resp = await client.post(
            "/api/v1/menu/scan/stream", files={"image": ("m.jpg", make_jpeg(), "image/jpeg")}
        )

    assert resp.status_code == 200  # ⚠️ 500 이 아니다
    lines = events(resp.text)
    assert len(lines) == 1
    assert lines[0]["type"] == "error"
    assert lines[0]["code"] == "upstream_timeout"
    assert lines[0]["partial"] is False
    assert lines[0]["message"]  # 한국어 사용자 메시지


async def test_failure_midstream_keeps_the_items_already_sent(client_factory):
    """30번째 항목에서 끊겨도 앞의 29개는 유효하다. partial=true 로 알린다."""
    fake = FakeGemini(error=UnreadableMenu())
    fake.stream_error_after = 1
    async with client_factory(fake) as client:
        resp = await client.post(
            "/api/v1/menu/scan/stream", files={"image": ("m.jpg", make_jpeg(), "image/jpeg")}
        )

    lines = events(resp.text)
    assert [e["type"] for e in lines] == ["meta", "item", "error"]
    assert lines[-1]["partial"] is True


async def test_stream_is_not_in_the_public_openapi_contract(client_factory):
    """줄마다 형태가 달라 response_model 로 못 적는다. 반쪽 스키마를 넣지 않는다."""
    async with client_factory() as client:
        schema = (await client.get("/openapi.json")).json()

    assert not [p for p in schema["paths"] if "scan/stream" in p]
