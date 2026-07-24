from __future__ import annotations

import io

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from app.main import create_app
from app.schemas.menu import (
    ItemExplanation,
    LikelyAllergen,
    MenuExtraction,
    MenuItemSummary,
    Restaurant,
)
from app.schemas.chat import Translation, VoiceResult
from app.services.gemini import (
    ExplainOutcome,
    ScanOutcome,
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


class FakeGemini:
    """네트워크 없이 라우트/에러매핑을 검증하기 위한 대역."""

    def __init__(self, result=None, error: Exception | None = None):
        self.result = result if result is not None else sample_extraction()
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

    async def explain_item(self, req, *, models=None):
        self.calls.append({"explain": req.name_local})
        if self.error:
            raise self.error
        return ExplainOutcome(
            explanation=sample_explanation(),
            model="fake-model",
            usage=Usage(input_tokens=200, output_tokens=380),
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
