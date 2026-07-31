"""점원 대화(통역) 스키마.

주문 '카드'는 서버를 부르지 않는다(오프라인에서 점원에게 보여줘야 하므로 클라이언트가
조립). 이 엔드포인트는 **자유 발화 번역 전용**이다.
"""

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.menu import LANG_MAX, TravelerLang

Direction = Literal["traveler2local", "local2traveler", "ko2local", "local2ko"]


class Translation(BaseModel):
    """Gemini 가 채우는 부분."""

    translated: str = Field(description="번역문. 방향에 따라 현지어 또는 여행자 언어.")
    reading: str = Field(
        description="traveler2local 이면 번역한 현지어의 여행자 언어 발음 안내. "
        "local2traveler 이면 빈 문자열."
    )


class ChatRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500, description="번역할 한 문장")
    # 상한 근거는 schemas/menu.py 의 LANG_MAX 주석 참고(짧게 잡으면 zh-Hant-TW 에서 422).
    # 값의 출처가 스캔 응답이라 두 곳이 갈리면 안 된다 — 상수를 공유한다.
    source_lang: str = Field(
        default="ja", max_length=LANG_MAX, description="현지어 BCP-47. 스캔 응답의 source_lang"
    )
    traveler_lang: TravelerLang = Field(default="ko", description="여행자 UI 언어")
    direction: Direction = Field(
        description="traveler2local: 여행자→현지어 / local2traveler: 현지어→여행자. "
        "기존 ko2local/local2ko 도 호환 입력으로 허용."
    )


class ChatResponse(Translation):
    model: str
    latency_ms: int


class VoiceResult(BaseModel):
    """Gemini 가 오디오에서 채우는 부분."""

    source_text: str = Field(description="말한 내용을 원래 언어 그대로 받아쓴 것")
    translated: str = Field(description="번역문. 방향에 따라 현지어 또는 여행자 언어.")
    reading: str = Field(
        description="traveler2local 이면 현지어의 여행자 언어 발음 안내. 반대 방향이면 빈 문자열."
    )


class VoiceResponse(VoiceResult):
    model: str
    latency_ms: int
