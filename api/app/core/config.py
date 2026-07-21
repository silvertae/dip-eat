from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="DIPEAT_", extra="ignore")

    # --- Gemini -------------------------------------------------------------
    # 키는 GEMINI_API_KEY 로도 받는다(google-genai SDK 관례). alias 로 둘 다 허용.
    gemini_api_key: str = ""
    # preview 모델은 예고 없이 내려갈 수 있어 폴백을 반드시 둔다.
    gemini_model: str = "gemini-3-flash-preview"
    gemini_model_fallback: str = "gemini-3.5-flash"
    # 손글씨 벽보 메뉴판은 'medium' 에서 포화되지 않는다. 실사진으로 A/B 할 것.
    gemini_media_resolution: str = "MEDIA_RESOLUTION_HIGH"
    gemini_timeout_s: float = 45.0
    gemini_max_attempts: int = 2

    # --- 업로드 -------------------------------------------------------------
    # 클라이언트가 2048px/q0.78 로 줄여 보내면 보통 350~700KB. 여유를 둬서 8MB.
    max_upload_bytes: int = 8 * 1024 * 1024
    # 서버 재리사이즈 목표 긴 변(px)
    target_long_edge: int = 2048
    jpeg_quality: int = 85

    # --- 앱 -----------------------------------------------------------------
    # Vercel rewrites 를 쓰면 동일 출처가 되어 CORS 가 필요 없지만, 폴백으로 유지한다.
    # pydantic-settings 는 list[str] 을 JSON 으로 파싱한다: '["https://a.com"]'
    cors_origins: list[str] = ["http://localhost:5173"]
    log_level: str = "INFO"
    # 업스트림 원문 에러를 응답 body 의 `detail` 에 포함할지. 로컬 개발에서만 켠다.
    # 끄더라도 서버 로그에는 항상 남는다.
    debug_errors: bool = False

    @property
    def resolved_api_key(self) -> str:
        import os

        return self.gemini_api_key or os.getenv("GEMINI_API_KEY", "")


@lru_cache
def get_settings() -> Settings:
    return Settings()
