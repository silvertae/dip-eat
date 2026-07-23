"""메뉴 스캔 스키마.

`MenuExtraction` / `ItemExplanation` 은 **Gemini 의 response_schema 로 그대로 넘어간다.** 그래서:
  - 최상위 1개 객체 + 배열 한 겹까지만. 재귀 타입/oneOf 체인 금지(OpenAPI 3.0 서브셋).
  - 필드 description 이 곧 모델에 대한 지시문이다. 성의 있게 쓸 것.

## 왜 2단계로 나뉘어 있나

실사진 계측 결과 이 엔드포인트의 지연은 거의 전부 '출력 토큰'에서 나왔고(입력은 사진
크기와 무관하게 ~1,870 고정), 40개짜리 메뉴판의 출력 9,565 토큰 중
`likely_allergens` 가 43.3%, `description` 이 22.3% 를 차지했다. 항목마다 붙는
알레르기 '근거 문장'이 단일 최대 비용이었다.

그래서 목록(`MenuItemSummary`)에는 화면에 바로 필요한 것만 담고, 긴 설명·근거 문장·
로마자는 사용자가 카드를 탭했을 때 `ItemExplanation` 으로 따로 받는다. 사용자가 열지
않는 메뉴는 비용을 아예 내지 않는다. 알레르기 '차단'은 코드만 있으면 되므로 목록에서
그대로 동작한다.
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


# --- 1단계: 목록 (사진 1장 → 전 항목) ----------------------------------------


class MenuItemSummary(BaseModel):
    """결과 목록 카드에 바로 필요한 것만. 여기에 필드를 늘리면 항목 수만큼 곱해진다."""

    name_local: str = Field(
        description="메뉴판에 적힌 원문 그대로. 절대 번역·정규화하지 말 것. 장음부호(ー)나 "
        "가나 표기도 보이는 대로. 사용자가 이 글자를 점원에게 그대로 보여준다."
    )
    name_translated: str = Field(description="한국어 번역명. 음차가 자연스러우면 음차.")
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
    section: str = Field(
        description="이 항목이 메뉴판에서 어느 분류 아래 적혀 있는지, 그 분류 제목을 한국어로. "
        "예: '튀김', '찬푸르', '국물', '130엔 접시'. "
        "**메뉴판에 실제로 적힌 분류만 쓸 것** — 분류 제목이 없는 메뉴판이면 빈 문자열. "
        "직접 분류를 만들어내지 말 것."
    )
    summary: str = Field(
        description="이게 무슨 음식인지 한 줄로. **25자 이내.** 예: '흑설탕에 조린 삼겹살'. "
        "긴 설명은 여기 쓰지 말 것 — 사용자가 카드를 탭하면 따로 받아온다."
    )
    image_query: str = Field(
        description="이 요리의 참고 사진을 위키미디어 커먼즈에서 찾기 위한 영문/로마자 검색어 한 개. "
        "가장 널리 통용되는 요리명으로. 예: 'tamagoyaki', 'goya champuru', 'okinawa soba', "
        "'gurukun fried fish'. 재료+조리법 조합이면 그렇게(예: 'fried island scallion'). "
        "커먼즈 파일 제목이 대부분 영문이라 원문보다 영문이 잘 맞는다. 모르면 빈 문자열."
    )
    tags: list[MenuTag] = Field(description="해당하는 것만. 없으면 빈 배열.")
    allergens: list[AllergenCode] = Field(
        description="메뉴명·재료로 정당화할 수 있는 알레르기 코드만. 근거를 댈 수 없으면 넣지 말 것. "
        "억지로 채우지 말 것. (근거 문장은 상세 조회에서 따로 받는다)"
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
    items: list[MenuItemSummary] = Field(
        description="메뉴판에서 읽은 항목 전부. 사진에 없는 메뉴를 지어내지 말 것. "
        "카테고리 제목(예: '一品料理')이나 가격대 제목(예: '皿 一三〇円')은 항목이 아니므로 제외. "
        "단, 가격대 제목 아래 나열된 항목들에는 그 가격을 각각 채워 넣을 것."
    )
    warnings: list[str] = Field(
        description="사용자에게 알려야 할 문제를 한국어로. 예: '메뉴판 오른쪽이 잘려 일부를 읽지 못했어요'. "
        "문제가 없으면 빈 배열."
    )


# --- 2단계: 상세 (항목 1개, 탭했을 때) ---------------------------------------


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


class ItemExplanation(BaseModel):
    """상세 모달용. 항목 1개라 길게 써도 된다."""

    romanization: str = Field(description="현지어 발음의 로마자 표기. 모르면 빈 문자열.")
    pronunciation_ko: str = Field(
        description="한국어 독음. 점원에게 소리내어 말할 때 쓴다. 예: '라후테-'"
    )
    description: str = Field(
        description="어떤 음식인지 2~3문장. 맛·식감·조리법·먹는 방법 중심. "
        "호불호가 갈릴 요소(쓴맛, 강한 향신료, 높은 도수, 생식)는 반드시 언급."
    )
    tip: str = Field(
        description="한국인 여행자에게 도움이 될 조언 한두 문장. 주문 요령, 양, 곁들임 등. "
        "해당 사항이 없으면 빈 문자열."
    )
    allergens: list[LikelyAllergen] = Field(
        description="메뉴명·재료로 정당화할 수 있는 것만. 근거를 댈 수 없으면 넣지 말 것."
    )


# --- API 응답 (Gemini 스키마 아님) -------------------------------------------


class ScanMeta(BaseModel):
    model: str
    latency_ms: int
    image_px: str


class MenuScanResponse(MenuExtraction):
    scan_id: str
    meta: ScanMeta


class ExplainRequest(BaseModel):
    name_local: str = Field(description="1단계 응답의 name_local 을 그대로")
    name_translated: str = ""
    source_lang: str = Field(default="ja", description="1단계 응답의 source_lang")
    cuisine_hint: str = Field(default="", description="가게 성격. 있으면 설명이 정확해진다")


class ExplainResponse(ItemExplanation):
    name_local: str
    model: str
    latency_ms: int


class ErrorResponse(BaseModel):
    code: str
    message: str
    detail: str | None = None
