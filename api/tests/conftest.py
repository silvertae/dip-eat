from __future__ import annotations

import io

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from app.main import create_app
from app.schemas.chat import Translation, VoiceResult
from app.schemas.menu import (
    ItemExplanation,
    LikelyAllergen,
    LocatedBox,
    LocateResult,
    MenuExtraction,
    MenuItemSummary,
    Restaurant,
)
from app.services.gemini import (
    ExplainOutcome,
    LocateOutcome,
    ScanHead,
    ScanOutcome,
    ScanTail,
    TranslateOutcome,
    Usage,
    VoiceOutcome,
)


def make_jpeg(width: int = 400, height: int = 300, *, noise: bool = False) -> bytes:
    """테스트용 JPEG. noise=True 면 압축이 잘 안 돼 파일이 커진다(크기 제한 테스트용)."""
    img = Image.new("RGB", (width, height), (240, 200, 160))
    if noise:
        import random

        rnd = random.Random(0)
        px = img.load()
        for y in range(height):
            for x in range(width):
                px[x, y] = (rnd.randrange(256), rnd.randrange(256), rnd.randrange(256))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


def sample_extraction() -> MenuExtraction:
    return MenuExtraction(
        source_lang="ja",
        currency="JPY",
        restaurant=Restaurant(
            name_local="ゆうなんぎい", name_translated="유난기", cuisine_hint="오키나와 가정식"
        ),
        items=[
            MenuItemSummary(
                name_local="ラフテー",
                name_translated="라후테",
                price_text="970円",
                price_amount=970,
                tax_included=True,
                category="food",
                section="돼지고기 요리",
                image_query="rafute",
                summary="흑설탕에 조린 삼겹살",
                tags=["signature", "local", "pork"],
                allergens=["pork", "soy"],
                ocr_confidence="high",
            )
        ],
        warnings=[],
    )


def sample_explanation() -> ItemExplanation:
    return ItemExplanation(
        romanization="Rafutē",
        pronunciation_ko="라후테-",
        description="아와모리·간장·흑설탕에 뭉근히 조린 오키나와식 삼겹살이에요. 달큰하고 부드러워요.",
        tip="밥과 함께 나눠 드시길 추천해요.",
        allergens=[
            LikelyAllergen(
                code="pork",
                label="돼지고기",
                inferred=True,
                basis="라후테는 돼지 삼겹살로 만드는 요리예요.",
                confidence="high",
            )
        ],
    )


def sample_locate() -> LocateResult:
    return LocateResult(
        boxes=[
            # 0~1000 → 라우트가 0~1 로 변환: x .08 y .13 w .68 h .05
            LocatedBox(
                index=1, name_local="ラフテー", found=True,
                ymin=130, xmin=80, ymax=180, xmax=760,
            ),
            LocatedBox(
                index=2, name_local="ゴーヤーチャンプルー", found=False,
                ymin=0, xmin=0, ymax=0, xmax=0,
            ),
        ]
    )


class FakeGemini:
    """네트워크 없이 라우트/에러매핑을 검증하기 위한 대역."""

    def __init__(self, result=None, error: Exception | None = None, locate_result=None):
        self.result = result if result is not None else sample_extraction()
        self.locate_result = locate_result if locate_result is not None else sample_locate()
        self.error = error
        self.calls: list[dict] = []

    async def extract_menu(self, image, *, mode: str, models=None):
        self.calls.append({"mode": mode, "bytes": len(image.data), "px": image.px})
        if self.error:
            raise self.error
        return ScanOutcome(
            extraction=self.result,
            model="fake-model",
            usage=Usage(input_tokens=1120, output_tokens=4200, thought_tokens=100),
        )

    async def stream_menu(self, image, *, mode: str, models=None):
        """실물과 같은 순서로 낸다: 머리 1개 → 항목 N개 → 꼬리 1개.

        `error` 를 준 경우, `stream_error_after` 만큼 항목을 내보낸 **뒤에** 터뜨린다.
        0이면 첫 항목 전에 터진다(= 폴백이 가능한 지점).
        """
        self.calls.append({"stream": mode, "bytes": len(image.data), "px": image.px})
        after = getattr(self, "stream_error_after", 0)
        if self.error and after == 0:
            raise self.error
        yield ScanHead(
            source_lang=self.result.source_lang,
            currency=self.result.currency,
            restaurant=self.result.restaurant,
            model="fake-model",
        )
        for index, item in enumerate(self.result.items):
            if self.error and index >= after:
                raise self.error
            yield item
        if self.error:
            # 항목을 다 낸 뒤에 터지는 경우(꼬리 직전). after 가 항목 수 이상일 때 여기로 온다.
            raise self.error
        yield ScanTail(
            warnings=list(self.result.warnings),
            model="fake-model",
            usage=Usage(input_tokens=1120, output_tokens=4200),
            items=len(self.result.items),
        )

    async def explain_item(self, req, *, models=None):
        self.calls.append({"explain": req.name_local})
        if self.error:
            raise self.error
        return ExplainOutcome(
            explanation=sample_explanation(),
            model="fake-model",
            usage=Usage(input_tokens=200, output_tokens=380),
        )

    async def locate_items(self, image, targets, *, models=None):
        self.calls.append({"locate": [t.name_local for t in targets], "px": image.px})
        if self.error:
            raise self.error
        return LocateOutcome(
            result=self.locate_result,
            model="fake-model",
            usage=Usage(input_tokens=1100, output_tokens=120),
        )

    async def translate(self, req, *, models=None):
        self.calls.append({"translate": req.text, "direction": req.direction})
        if self.error:
            raise self.error
        localized = req.direction == "ko2local"
        return TranslateOutcome(
            translation=Translation(
                translated="パクチー抜きでお願いします" if localized else "고수 빼주세요",
                reading="파쿠치- 누키데 오네가이시마스" if localized else "",
            ),
            model="fake-model",
            usage=Usage(input_tokens=60, output_tokens=40),
        )

    async def transcribe_and_translate(
        self, audio, mime_type, *, direction, source_lang, models=None
    ):
        self.calls.append({"voice_bytes": len(audio), "mime": mime_type, "direction": direction})
        if self.error:
            raise self.error
        localized = direction == "ko2local"
        return VoiceOutcome(
            result=VoiceResult(
                source_text="물 한 잔 주세요" if localized else "ご注文は以上でしょうか？",
                translated="お水を一杯ください" if localized else "주문은 이게 전부인가요?",
                reading="오미즈오 잇빠이 쿠다사이" if localized else "",
            ),
            model="fake-model",
            usage=Usage(input_tokens=320, output_tokens=40),
        )


@pytest.fixture
def app_with_fake_gemini():
    def _build(fake: FakeGemini | None = None):
        application = create_app()
        # ASGITransport 는 lifespan 을 돌리지 않으므로 state 를 직접 채운다.
        application.state.gemini = fake or FakeGemini()
        return application

    return _build


@pytest.fixture
def client_factory(app_with_fake_gemini):
    def _make(fake: FakeGemini | None = None) -> AsyncClient:
        application = app_with_fake_gemini(fake)
        return AsyncClient(
            transport=ASGITransport(app=application), base_url="http://test"
        )

    return _make
