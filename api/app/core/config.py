from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ThinkingLevel = Literal["minimal", "low", "medium", "high"]
# 빈 문자열이면 파라미터를 아예 보내지 않는다(미지원 모델 대응).
MediaResolution = Literal[
    "", "MEDIA_RESOLUTION_LOW", "MEDIA_RESOLUTION_MEDIUM", "MEDIA_RESOLUTION_HIGH"
]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="DIPEAT_", extra="ignore")

    # --- Gemini -------------------------------------------------------------
    # 접두사 없는 GEMINI_API_KEY 로도 받는다 — google-genai SDK 와 AI Studio 안내가
    # 그 이름을 쓰기 때문이다. validation_alias 를 주면 env_prefix 가 자동으로 붙지
    # 않으므로 접두사 붙은 이름도 명시해야 한다.
    gemini_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("DIPEAT_GEMINI_API_KEY", "GEMINI_API_KEY"),
    )

    # 1차: 싸고 빠른 효율 티어. 2차: 1차가 못 읽었을 때 올라가는 상위 모델.
    # extract_menu 는 1차로 max_attempts 만큼 시도한 뒤 폴백으로 넘어가므로,
    # 이 조합이 곧 "싸게 먼저, 안 되면 좋은 걸로" 에스컬레이션이 된다.
    gemini_model: str = "gemini-3.1-flash-lite"
    # gemini-3.5-flash 였으나 2026-07 기준 지속적으로 503(model overloaded)을 반환해
    # 폴백 역할을 못 했다. 3.6-flash 는 같은 키에서 정상 응답. scripts/probe_models.py 참고.
    gemini_model_fallback: str = "gemini-3.6-flash"

    # 손글씨 벽보는 'medium' 에서 포화되지 않는다. 다만 media_resolution 은 Gemini 3 계열
    # 전체에서 지원되는지 문서로 확정되지 않아, 빈 문자열이면 아예 보내지 않는다.
    # (지원하지 않는 모델에 보내면 400 이 난다 → 실사진 게이트에서 켜고/끄고 비교할 것)
    # (Literal 로 묶는 이유: SDK 는 잘못된 값을 UserWarning 만 내고 그대로 통과시킨다.
    #  오타 난 환경변수가 런타임에 400 으로 터지느니 부팅 때 죽는 게 낫다.)
    gemini_media_resolution: MediaResolution = "MEDIA_RESOLUTION_HIGH"
    # 기본값(HIGH)을 그대로 두면 지연이 2~4배가 되고 thinking 토큰이 '출력' 단가로 과금된다.
    # 실측(사진 10장): low 는 thinking 토큰이 0~3,541 로 널뛰며 p50 19.6s,
    # minimal 은 thinking 0 에 p50 15.6s 이고 추출량·가격 파싱률은 오히려 소폭 나았다.
    # OCR+구조화는 추론보다 '읽기' 과제라 사고 예산이 도움이 안 되는 것으로 보인다.
    gemini_thinking_level: ThinkingLevel = "minimal"
    gemini_timeout_s: float = 45.0
    gemini_max_attempts: int = 2

    # --- 위치 찾기(/menu/locate) 전용 ---------------------------------------
    # 바운딩 박스는 OCR 과 달리 '공간 그라운딩' 과제라 lite 모델이 약하다(상단 항목의 상자가
    # 텍스트 위 여백에 얹히는 실기기 사례). locate 는 on-demand·소수 항목이라 스캔 지연에
    # 영향을 안 주므로, 여기서는 정확도를 위해 상위 모델과 약간의 사고 예산을 쓴다.
    gemini_locate_model: str = "gemini-3.6-flash"
    gemini_locate_thinking_level: ThinkingLevel = "low"

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
        return self.gemini_api_key


@lru_cache
def get_settings() -> Settings:
    return Settings()
