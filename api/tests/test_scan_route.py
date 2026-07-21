from __future__ import annotations

import pytest

from app.core.errors import UnreadableMenu, UpstreamError, UpstreamRateLimited, UpstreamTimeout
from tests.conftest import FakeGemini, make_jpeg


async def test_scan_returns_full_contract(client_factory):
    async with client_factory() as client:
        resp = await client.post(
            "/api/v1/menu/scan",
            files={"image": ("m.jpg", make_jpeg(), "image/jpeg")},
            data={"mode": "booklet"},
        )
    assert resp.status_code == 200
    body = resp.json()

    assert body["source_lang"] == "ja"
    assert body["currency"] == "JPY"
    assert body["restaurant"]["name_local"] == "ゆうなんぎい"
    assert len(body["scan_id"]) == 32
    assert body["meta"]["model"] == "fake-model"
    assert body["meta"]["image_px"] == "400x300"
    assert body["meta"]["latency_ms"] >= 0

    item = body["items"][0]
    # 원문 verbatim 이 응답에 반드시 남아야 한다 — 사용자가 점원에게 이 글자를 보여준다.
    assert item["name_local"] == "ラフテー"
    assert item["name_translated"] == "라후테"
    assert item["price_amount"] == 970
    assert item["tax_included"] is True
    assert "signature" in item["tags"]
    assert item["ocr_confidence"] == "high"
    # 서버는 원화를 모른다. 환산은 클라이언트 몫.
    assert "price_krw" not in item


async def test_mode_is_forwarded_to_gemini(client_factory):
    fake = FakeGemini()
    async with client_factory(fake) as client:
        await client.post(
            "/api/v1/menu/scan",
            files={"image": ("m.jpg", make_jpeg(), "image/jpeg")},
            data={"mode": "kiosk"},
        )
    assert fake.calls[0]["mode"] == "kiosk"


async def test_invalid_mode_is_rejected(client_factory):
    async with client_factory() as client:
        resp = await client.post(
            "/api/v1/menu/scan",
            files={"image": ("m.jpg", make_jpeg(), "image/jpeg")},
            data={"mode": "hologram"},
        )
    assert resp.status_code == 422


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (UnreadableMenu(), 422, "unreadable_menu"),
        (UpstreamTimeout(), 504, "upstream_timeout"),
        (UpstreamRateLimited(), 429, "upstream_rate_limited"),
        (UpstreamError(), 502, "upstream_error"),
    ],
)
async def test_upstream_failures_map_to_clean_responses(client_factory, error, status, code):
    """httpx/genai 예외가 그대로 클라이언트에 새지 않고 한국어 메시지로 나가는지."""
    async with client_factory(FakeGemini(error=error)) as client:
        resp = await client.post(
            "/api/v1/menu/scan", files={"image": ("m.jpg", make_jpeg(), "image/jpeg")}
        )
    assert resp.status_code == status
    body = resp.json()
    assert body["code"] == code
    assert body["message"]
    assert "Traceback" not in body["message"]
    # debug_errors 가 꺼진 기본 상태에서는 업스트림 원문이 응답에 실리지 않는다.
    assert body["detail"] is None


async def test_health(client_factory):
    async with client_factory() as client:
        resp = await client.get("/api/v1/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
