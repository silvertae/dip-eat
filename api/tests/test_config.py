"""설정값 검증.

google-genai SDK 는 잘못된 enum 값을 UserWarning 만 내고 그대로 통과시킨다
(`TURBO is not a valid ThinkingLevel` 후 계속 진행). 그러면 오타 난 환경변수가
런타임에 400 으로 터진다. 그래서 Settings 단에서 막는다.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.schemas.menu import MenuExtraction
from app.services.gemini import GeminiService


def config_of(settings: Settings, *, with_media: bool = True):
    return GeminiService(settings)._config(
        system_instruction="sys", schema=MenuExtraction, with_media=with_media
    )


def test_defaults_are_flash_lite_first_then_stronger_fallback():
    settings = Settings(gemini_api_key="k")
    assert settings.gemini_model == "gemini-3.1-flash-lite"
    assert settings.gemini_model_fallback == "gemini-3.6-flash"
    assert settings.gemini_model != settings.gemini_model_fallback


@pytest.mark.parametrize("level", ["minimal", "low", "medium", "high"])
def test_valid_thinking_levels_reach_the_sdk_config(level):
    config = config_of(Settings(gemini_api_key="k", gemini_thinking_level=level))
    assert config.thinking_config.thinking_level.value == level.upper()


def test_typo_in_thinking_level_fails_at_startup_not_at_request_time():
    with pytest.raises(ValidationError):
        Settings(gemini_api_key="k", gemini_thinking_level="turbo")


def test_typo_in_media_resolution_fails_at_startup():
    with pytest.raises(ValidationError):
        Settings(gemini_api_key="k", gemini_media_resolution="ULTRA")


def test_empty_media_resolution_is_omitted_from_the_request():
    """지원하지 않는 모델에 보내면 400 이므로, 빈 값이면 파라미터 자체를 빼야 한다."""
    config = config_of(Settings(gemini_api_key="k", gemini_media_resolution=""))
    assert config.media_resolution is None


def test_media_resolution_is_sent_when_set():
    settings = Settings(gemini_api_key="k", gemini_media_resolution="MEDIA_RESOLUTION_HIGH")
    assert config_of(settings).media_resolution.value == "MEDIA_RESOLUTION_HIGH"


def test_api_key_is_read_from_bare_gemini_api_key_in_dotenv(tmp_path, monkeypatch):
    """`.env.example` 이 안내하는 접두사 없는 이름이 실제로 먹혀야 한다.

    env_prefix='DIPEAT_' 만 있으면 `GEMINI_API_KEY=...` 가 조용히 무시되어
    "키를 넣었는데 키가 없다"는 상태가 된다. 실제로 한 번 겪은 버그다.
    """
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("DIPEAT_GEMINI_API_KEY", raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text("GEMINI_API_KEY=from-dotenv\n", encoding="utf-8")

    assert Settings(_env_file=env_file).resolved_api_key == "from-dotenv"


def test_prefixed_name_also_works(tmp_path, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text("DIPEAT_GEMINI_API_KEY=prefixed\n", encoding="utf-8")

    assert Settings(_env_file=env_file).resolved_api_key == "prefixed"


def test_text_only_calls_never_send_media_resolution():
    """상세 설명은 사진을 안 보낸다. 이미지 파라미터를 붙일 이유가 없다."""
    settings = Settings(gemini_api_key="k", gemini_media_resolution="MEDIA_RESOLUTION_HIGH")
    assert config_of(settings, with_media=False).media_resolution is None
