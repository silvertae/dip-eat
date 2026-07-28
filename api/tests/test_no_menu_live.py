"""실제 Gemini 가 '메뉴판이 아닌 사진'에 메뉴를 지어내는지 확인한다. **네트워크를 탄다.**

기본은 skip 이다 — CI 는 네트워크를 안 타고, 이 프로젝트의 테스트는 아무 문자열이나 든
`GEMINI_API_KEY` 로 돈다(AGENTS.md). 진짜 키를 갖고 있을 때만 켠다:

    cd api && DIPEAT_LIVE_TESTS=1 uv run pytest tests/test_no_menu_live.py -v

이걸 왜 자동화해 두나: 이 버그는 **코드가 아니라 프롬프트/모델 거동**에서 났다.
프롬프트(`app/prompts/menu_scan.md`)나 모델 ID 를 바꾸면 `test_no_menu.py` 는 전부
통과하면서 환각만 되돌아올 수 있다. 그때 이 파일이 유일한 그물이다.

2026-07-28 실측: 이 가드 이전엔 흰 화면 8개 / 회색 8개 / 어두운 프레임 5개를 지어냈고,
가드 이후엔 1차·폴백 모델 모두 4개 픽스처 전부를 `menu_found=false, items=0` 으로 거절했다.
"""

from __future__ import annotations

import os

import pytest

from app.core.config import Settings
from app.core.errors import NoMenuFound
from app.services.gemini import GeminiService
from app.services.image import prepare_image
from tests.conftest import NO_MENU_FIXTURES

pytestmark = pytest.mark.skipif(
    os.environ.get("DIPEAT_LIVE_TESTS") != "1",
    reason="실 API 호출. DIPEAT_LIVE_TESTS=1 로만 실행한다.",
)


def live_settings() -> Settings:
    settings = Settings()
    # 테스트 기본 키는 아무 문자열이라 호출이 401 로 죽는다. 진짜 키가 아니면 아예 건너뛴다.
    if len(settings.resolved_api_key) < 20:
        pytest.skip("진짜 GEMINI_API_KEY 가 없다 (api/.env 확인)")
    return settings


@pytest.mark.parametrize("fixture_name", sorted(NO_MENU_FIXTURES))
@pytest.mark.parametrize("which_model", ["gemini_model", "gemini_model_fallback"])
async def test_blank_photos_are_refused_not_invented(fixture_name: str, which_model: str):
    """1차·폴백 **양쪽 모두** 거절해야 한다. 한쪽만 막으면 폴백이 환각을 서빙한다."""
    settings = live_settings()
    service = GeminiService(settings)
    prepared = prepare_image(
        NO_MENU_FIXTURES[fixture_name](), target_long_edge=2048, jpeg_quality=85
    )

    with pytest.raises(NoMenuFound):
        await service.extract_menu(
            prepared, mode="poster", models=[getattr(settings, which_model)]
        )


@pytest.mark.parametrize("fixture_name", sorted(NO_MENU_FIXTURES))
async def test_stream_sends_no_item_for_a_blank_photo(fixture_name: str):
    """스트리밍은 프런트가 쓰는 경로다. 여기서 새면 카드가 화면에 실제로 뜬다."""
    service = GeminiService(live_settings())
    prepared = prepare_image(
        NO_MENU_FIXTURES[fixture_name](), target_long_edge=2048, jpeg_quality=85
    )

    emitted = []
    with pytest.raises(NoMenuFound):
        async for event in service.stream_menu(prepared, mode="poster"):
            emitted.append(event)

    assert emitted == [], f"{fixture_name}: 지어낸 항목이 스트림으로 나갔다"
