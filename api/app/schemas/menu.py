"""메뉴 스캔 스키마.

`MenuExtraction` 은 **Gemini 의 response_schema 로 그대로 넘어간다.** 그래서:
  - 최상위 1개 객체 + 배열 한 겹까지만. 재귀 타입/oneOf 체인 금지(OpenAPI 3.0 서브셋).
  - 필드 description 이 곧 모델에 대한 지시문이다. 성의 있게 쓸 것.
"""

from typing import Literal

from pydantic import BaseModel, Field

# 한국 식약처 표시대상 알레르기 유발물질 + 국제적으로 흔한 항목.
# 코드가 안정적이어야 클라이언트가 프로필과 정확히 대조할 수 있다.
AllergenCode = Literal[
    "egg", "milk", "buckwheat", "peanut", "soy", "wheat", "gluten",
    "mackerel", "fish", "crab", "shrimp", "crustacean", "squid", "shellfish", "mollusk",
    "pork", "beef", "chicken", "peach", "tomato", "sulfite",
    "walnut", "pine_nut", "tree_nut", "sesame", "celery", "mustard", "alcohol", "other",
]

# 목업의 배지와 1:1 대응(sig/local/caution/pork/veg/alcohol/share/portion) + 약간의 확장.
MenuTag = Literal[
    "signature", "local", "caution", "spicy", "raw",
    "vegetarian", "vegan", "pork", "beef", "chicken", "seafood",
    "alcohol", "share", "single_portion", "noodle", "rice", "soup", "fried", "dessert",
]

Confidence = Literal["high", "medium", "low"]
Category = Literal["food", "drink", "dessert", "set", "unknown"]


class LikelyAllergen(BaseModel):
    """⚠️ 메뉴판에서 '읽은' 사실이 아니라 요리 지식에서 '추론한' 값이다.

    UI 는 반드시 추정임을 고지해야 한다. 식품 안전 문제라 이 구분이 중요하다.
    """

    code: AllergenCode = Field(description="표준 알레르기 코드")
    label: str = Field(description="한국어 표시명. 예: '새우'")
    inferred: bool = Field(
        description="메뉴판에 명시돼 있지 않고 요리 지식으로 추론했으면 true. 대부분 true 다."
    )
    basis: str = Field(
        description="그렇게 판단한 근거를 한국어 한 문장으로. 예: \"메뉴명에 'エビ'(새우)가 있음\""
    )
    confidence: Confidence = Field(description="확신도")


class MenuItem(BaseModel):
    name_local: str = Field(
        description="메뉴판에 적힌 원문 그대로. 절대 번역·정규화하지 말 것. 읽은 글자만."
    )
    name_translated: str = Field(description="한국어 번역명. 음차가 자연스러우면 음차.")
    romanization: str = Field(description="로마자 표기. 없으면 빈 문자열.")
    price_text: str = Field(
        description="가격을 적힌 그대로. 예: '970円', '¥970', '時価'. 못 읽었으면 빈 문자열."
    )
    price_amount: int | None = Field(
        description="price_text 에서 파싱한 숫자만. 범위·시가·판독 불가면 null."
    )
    tax_included: bool | None = Field(
        description="税込이면 true, 税抜/+税면 false, 표기가 없으면 null."
    )
    category: Category = Field(description="분류")
    description: str = Field(
        description="한국인 여행자가 처음 봐도 알 수 있게 2~3문장. 맛·식감·먹는 법 위주. "
        "메뉴판에 설명이 없으면 요리 일반 지식으로 채우되 지어내지 말 것."
    )
    tags: list[MenuTag] = Field(description="해당하는 것만. 없으면 빈 배열.")
    likely_allergens: list[LikelyAllergen] = Field(
        description="메뉴명·재료로 정당화할 수 있는 것만. 근거를 댈 수 없으면 넣지 말 것. "
        "억지로 채우지 말고, 확실하지 않으면 confidence 를 낮출 것."
    )
    ocr_confidence: Confidence = Field(description="이 항목의 글자를 얼마나 확실히 읽었는지")


class Restaurant(BaseModel):
    name_local: str = Field(description="사진에서 읽은 가게 이름 원문. 없으면 빈 문자열.")
    name_translated: str = Field(description="한국어 표기. 없으면 빈 문자열.")
    cuisine_hint: str = Field(description="음식 종류 한 마디. 예: '오키나와 가정식'. 모르면 빈 문자열.")


class MenuExtraction(BaseModel):
    """Gemini 가 채우는 부분. 서버가 만드는 값(scan_id, meta)은 여기 없다."""

    source_lang: str = Field(description="메뉴판 언어의 BCP-47 코드. 예: 'ja', 'th', 'vi'")
    currency: str = Field(description="ISO 4217 통화 코드. 예: 'JPY'. 모르면 빈 문자열.")
    restaurant: Restaurant
    items: list[MenuItem] = Field(
        description="메뉴판에서 읽은 항목 전부. 사진에 없는 메뉴를 지어내지 말 것. "
        "카테고리 제목(예: '一品料理')은 항목이 아니므로 제외."
    )
    warnings: list[str] = Field(
        description="사용자에게 알려야 할 문제를 한국어로. 예: '메뉴판 오른쪽이 잘려 일부를 읽지 못했어요'. "
        "문제가 없으면 빈 배열."
    )


# --- API 응답 (Gemini 스키마 아님) -------------------------------------------


class ScanMeta(BaseModel):
    model: str
    latency_ms: int
    image_px: str


class MenuScanResponse(MenuExtraction):
    scan_id: str
    meta: ScanMeta


class ErrorResponse(BaseModel):
    code: str
    message: str
    detail: str | None = None
