"""설정값 검증.

google-genai SDK 는 잘못된 enum 값을 UserWarning 만 내고 그대로 통과시킨다
(`TURBO is not a valid ThinkingLevel` 후 계속 진행). 그러면 오타 난 환경변수가
런타임에 400 으로 터진다. 그래서 Settings 단에서 막는다.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.services.gemini import GeminiService


def test_defaults_are_flash_lite_first_then_stronger_fallback():
    settings = Settings(gemini_api_key="k")
    assert settings.gemini_model == "gemini-3.1-flash-lite"
    assert settings.gemini_model_fallback == "gemini-3.5-flash"
    assert settings.gemini_model != settings.gemini_model_fallback


@pytest.mark.parametrize("level", ["minimal", "low", "medium", "high"])
def test_valid_thinking_levels_reach_the_sdk_config(level):
    service = GeminiService(Settings(gemini_api_key="k", gemini_thinking_level=level))
    config = service._config("poster")
    assert config.thinking_config.thinking_level.value == level.upper()


def test_typo_in_thinking_level_fails_at_startup_not_at_request_time():
    with pytest.raises(ValidationError):
        Settings(gemini_api_key="k", gemini_thinking_level="turbo")


def test_typo_in_media_resolution_fails_at_startup():
    with pytest.raises(ValidationError):
        Settings(gemini_api_key="k", gemini_media_resolution="ULTRA")


def test_empty_media_resolution_is_omitted_from_the_request():
    """지원하지 않는 모델에 보내면 400 이므로, 빈 값이면 파라미터 자체를 빼야 한다."""
    service = GeminiService(Settings(gemini_api_key="k", gemini_media_resolution=""))
    assert service._config("poster").media_resolution is None


def test_media_resolution_is_sent_when_set():
    service = GeminiService(
        Settings(gemini_api_key="k", gemini_media_resolution="MEDIA_RESOLUTION_HIGH")
    )
    assert service._config("poster").media_resolution.value == "MEDIA_RESOLUTION_HIGH"


def test_capture_mode_hint_reaches_the_system_instruction():
    service = GeminiService(Settings(gemini_api_key="k"))
    assert "벽보형" in service._config("poster").system_instruction
    assert "키오스크" in service._config("kiosk").system_instruction
