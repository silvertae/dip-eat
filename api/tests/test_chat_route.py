from __future__ import annotations

import pytest

from app.core.errors import UpstreamRateLimited, UpstreamTimeout
from tests.conftest import FakeGemini


async def test_ko_to_local_returns_translation_and_reading(client_factory):
    async with client_factory() as client:
        resp = await client.post(
            "/api/v1/chat",
            json={"text": "고수 빼주세요", "source_lang": "ja", "direction": "ko2local"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["translated"] == "パクチー抜きでお願いします"
    # ko2local 은 소리내어 말할 수 있게 한국어 독음도 준다.
    assert body["reading"] == "파쿠치- 누키데 오네가이시마스"
    assert body["model"] == "fake-model"
    assert body["latency_ms"] >= 0


async def test_local_to_ko_has_no_reading(client_factory):
    fake = FakeGemini()
    async with client_factory(fake) as client:
        resp = await client.post(
            "/api/v1/chat",
            json={"text": "パクチー抜きですね", "source_lang": "ja", "direction": "local2ko"},
        )
    assert resp.status_code == 200
    assert resp.json()["translated"] == "고수 빼주세요"
    assert resp.json()["reading"] == ""
    assert fake.calls[0]["direction"] == "local2ko"


async def test_empty_text_is_rejected(client_factory):
    async with client_factory() as client:
        resp = await client.post(
            "/api/v1/chat", json={"text": "", "direction": "ko2local"}
        )
    assert resp.status_code == 422


async def test_invalid_direction_is_rejected(client_factory):
    async with client_factory() as client:
        resp = await client.post(
            "/api/v1/chat", json={"text": "안녕", "direction": "sideways"}
        )
    assert resp.status_code == 422


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [(UpstreamTimeout(), 504, "upstream_timeout"), (UpstreamRateLimited(), 429, "upstream_rate_limited")],
)
async def test_upstream_failure_is_mapped(client_factory, error, status, code):
    async with client_factory(FakeGemini(error=error)) as client:
        resp = await client.post(
            "/api/v1/chat", json={"text": "물 주세요", "direction": "ko2local"}
        )
    assert resp.status_code == status
    assert resp.json()["code"] == code
