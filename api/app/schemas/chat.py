"""점원 대화(통역) 스키마.

주문 '카드'는 서버를 부르지 않는다(오프라인에서 점원에게 보여줘야 하므로 클라이언트가
조립). 이 엔드포인트는 **자유 발화 번역 전용**이다.
"""

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.menu import LANG_MAX

Direction = Literal["ko2local", "local2ko"]


class Translation(BaseModel):
    """Gemini 가 채우는 부분."""

    translated: str = Field(description="번역문. 방향에 따라 현지어 또는 한국어.")
    reading: str = Field(
        description="ko2local 이면 번역한 현지어의 한국어 독음(소리내어 말할 때). "
        "예: 'パクチー抜きで' → '파쿠치- 누키데'. local2ko 이면 빈 문자열."
    )


class ChatRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500, description="번역할 한 문장")
    # 상한 근거는 schemas/menu.py 의 LANG_MAX 주석 참고(짧게 잡으면 zh-Hant-TW 에서 422).
    # 값의 출처가 스캔 응답이라 두 곳이 갈리면 안 된다 — 상수를 공유한다.
    source_lang: str = Field(
        default="ja", max_length=LANG_MAX, description="현지어 BCP-47. 스캔 응답의 source_lang"
    )
    direction: Direction = Field(description="ko2local: 내 한국어→현지어 / local2ko: 점원 현지어→한국어")


class ChatResponse(Translation):
    model: str
    latency_ms: int


class VoiceResult(BaseModel):
    """Gemini 가 오디오에서 채우는 부분."""

    source_text: str = Field(description="말한 내용을 원래 언어 그대로 받아쓴 것")
    translated: str = Field(description="번역문. 방향에 따라 현지어 또는 한국어.")
    reading: str = Field(
        description="ko2local 이면 번역한 현지어의 한국어 독음. local2ko 이면 빈 문자열."
    )


class VoiceResponse(VoiceResult):
    model: str
    latency_ms: int
