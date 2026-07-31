from __future__ import annotations

import pytest

from app.core.errors import UnclearAudio, UpstreamRateLimited, UpstreamTimeout
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


async def test_japanese_traveler_direction_is_forwarded(client_factory):
    fake = FakeGemini()
    async with client_factory(fake) as client:
        resp = await client.post(
            "/api/v1/chat",
            json={
                "text": "お水をください",
                "source_lang": "ko",
                "traveler_lang": "ja",
                "direction": "traveler2local",
            },
        )
    assert resp.status_code == 200
    assert fake.calls[0]["direction"] == "traveler2local"


@pytest.mark.parametrize(
    "source_lang",
    [
        "ja",  # 대부분의 경우
        "zh-Hant",  # 문자 계열
        "zh-Hant-TW",  # 언어-문자-지역 (10자) — 상한 8 에서 422 였다
        "sr-Latn-RS",  # 같은 모양의 다른 언어
        "sl-Latn-IT-nedis",  # 변형(variant)까지 (16자)
    ],
)
async def test_real_world_bcp47_tags_are_accepted(client_factory, source_lang):
    """⚠️ 스캔이 내려주는 source_lang 에는 길이 제한이 없고 프런트가 그 값을 그대로 넘긴다.
    여기 상한을 짧게 잡으면 '스캔은 됐는데 대화·상세가 422' 라는 조용한 실패가 난다.
    /menu/item/explain 도 같은 상수를 쓰므로 함께 지켜진다."""
    async with client_factory() as client:
        resp = await client.post(
            "/api/v1/chat",
            json={"text": "고수 빼주세요", "source_lang": source_lang, "direction": "ko2local"},
        )
    assert resp.status_code == 200, resp.text


async def test_absurdly_long_source_lang_is_still_rejected(client_factory):
    """상한을 늘렸다고 없앤 건 아니다 — 프롬프트 크기는 여전히 묶여 있어야 한다."""
    async with client_factory() as client:
        resp = await client.post(
            "/api/v1/chat",
            json={"text": "고수 빼주세요", "source_lang": "ja" * 500, "direction": "ko2local"},
        )
    assert resp.status_code == 422


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


# --- 음성 (chat/voice) -------------------------------------------------------


async def test_voice_local_to_ko_transcribes_and_translates(client_factory):
    fake = FakeGemini()
    async with client_factory(fake) as client:
        resp = await client.post(
            "/api/v1/chat/voice",
            files={"audio": ("clip.webm", b"fake-audio-bytes", "audio/webm")},
            data={"direction": "local2ko", "source_lang": "ja"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["source_text"] == "ご注文は以上でしょうか？"  # 원어 그대로 받아쓰기
    assert body["translated"] == "주문은 이게 전부인가요?"
    assert fake.calls[0]["mime"] == "audio/webm"


async def test_voice_ko_to_local_has_reading(client_factory):
    async with client_factory() as client:
        resp = await client.post(
            "/api/v1/chat/voice",
            files={"audio": ("clip.mp4", b"abc", "audio/mp4")},
            data={"direction": "ko2local"},
        )
    body = resp.json()
    assert body["translated"] == "お水を一杯ください"
    assert body["reading"] == "오미즈오 잇빠이 쿠다사이"


async def test_voice_accepts_japanese_traveler(client_factory):
    fake = FakeGemini()
    async with client_factory(fake) as client:
        resp = await client.post(
            "/api/v1/chat/voice",
            files={"audio": ("clip.webm", b"fake-audio-bytes", "audio/webm")},
            data={
                "direction": "local2traveler",
                "source_lang": "ko",
                "traveler_lang": "ja",
            },
        )
    assert resp.status_code == 200
    assert fake.calls[0]["traveler_lang"] == "ja"


async def test_voice_rejects_non_audio(client_factory):
    async with client_factory() as client:
        resp = await client.post(
            "/api/v1/chat/voice",
            files={"audio": ("x.txt", b"hello", "text/plain")},
            data={"direction": "local2ko"},
        )
    assert resp.status_code == 415
    body = resp.json()
    # 오디오 실패가 이미지 오류(415 unsupported_image, JPEG/PNG 안내)처럼 보이면 안 된다.
    assert body["code"] == "unsupported_audio"
    assert "이미지" not in body["message"] and "JPEG" not in body["message"]


async def test_voice_rejects_empty(client_factory):
    async with client_factory() as client:
        resp = await client.post(
            "/api/v1/chat/voice",
            files={"audio": ("x.webm", b"", "audio/webm")},
            data={"direction": "local2ko"},
        )
    assert resp.status_code == 415
    assert resp.json()["code"] == "unsupported_audio"


async def test_voice_rejects_oversized(client_factory):
    # 4MB 초과(과대)는 413. 미들웨어 총량 상한(8MB)보다 작아 라우터 검증까지 도달한다.
    big = b"\x00" * (5 * 1024 * 1024)
    async with client_factory() as client:
        resp = await client.post(
            "/api/v1/chat/voice",
            files={"audio": ("clip.webm", big, "audio/webm")},
            data={"direction": "local2ko"},
        )
    assert resp.status_code == 413
    assert resp.json()["code"] == "audio_too_large"


async def test_voice_unclear_audio_maps_422(client_factory):
    # 형식·용량은 통과했지만 모델이 못 알아들은 경우 — 입력 거절과 구분되는 422.
    async with client_factory(FakeGemini(error=UnclearAudio())) as client:
        resp = await client.post(
            "/api/v1/chat/voice",
            files={"audio": ("clip.webm", b"fake-audio-bytes", "audio/webm")},
            data={"direction": "local2ko", "source_lang": "ja"},
        )
    assert resp.status_code == 422
    assert resp.json()["code"] == "unclear_audio"
