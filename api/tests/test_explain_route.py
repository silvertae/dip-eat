"""상세 조회(2단계) 엔드포인트.

목록(1단계)이 가벼운 게 이 서비스의 응답시간을 좌우하므로, '목록에 무거운 필드가
다시 새어 들어오지 않는지'를 여기서 함께 지킨다.
"""

from __future__ import annotations

from app.core.errors import UpstreamTimeout
from tests.conftest import FakeGemini, make_jpeg

BODY = {
    "name_local": "ラフテー",
    "name_translated": "라후테",
    "source_lang": "ja",
    "cuisine_hint": "오키나와 가정식",
}


async def test_explain_returns_long_form_content(client_factory):
    async with client_factory() as client:
        resp = await client.post("/api/v1/menu/item/explain", json=BODY)

    assert resp.status_code == 200
    body = resp.json()
    assert body["name_local"] == "ラフテー"  # 요청한 항목이 그대로 되돌아온다
    assert body["romanization"] == "Rafutē"
    assert body["pronunciation_ko"]
    assert len(body["description"]) > 20
    assert body["tip"]
    assert body["latency_ms"] >= 0

    allergen = body["allergens"][0]
    assert allergen["code"] == "pork"
    # 식품 안전: 추정이라는 사실과 근거가 함께 와야 UI 가 고지할 수 있다.
    assert allergen["inferred"] is True
    assert allergen["basis"]
    assert allergen["confidence"] in {"high", "medium", "low"}


async def test_explain_requires_name_local(client_factory):
    async with client_factory() as client:
        resp = await client.post("/api/v1/menu/item/explain", json={"source_lang": "ja"})
    assert resp.status_code == 422


async def test_explain_upstream_failure_is_mapped(client_factory):
    async with client_factory(FakeGemini(error=UpstreamTimeout())) as client:
        resp = await client.post("/api/v1/menu/item/explain", json=BODY)
    assert resp.status_code == 504
    assert resp.json()["code"] == "upstream_timeout"


async def test_scan_list_stays_lean(client_factory):
    """목록 항목에 긴 필드가 다시 들어오면 응답시간이 항목 수만큼 곱해져 되돌아온다.

    실측: 40개 메뉴판에서 likely_allergens 가 출력 토큰의 43%, description 이 22% 였다.
    """
    async with client_factory() as client:
        resp = await client.post(
            "/api/v1/menu/scan", files={"image": ("m.jpg", make_jpeg(), "image/jpeg")}
        )

    item = resp.json()["items"][0]
    assert item["summary"] == "흑설탕에 조린 삼겹살"
    assert len(item["summary"]) <= 25
    # 분류는 짧은 문자열 하나. 목록에서 접기/펴기에 쓰인다.
    assert item["section"] == "돼지고기 요리"

    # 알레르기는 '코드만'. 차단 판정에는 코드로 충분하고, 근거 문장은 상세에서 받는다.
    assert item["allergens"] == ["pork", "soy"]

    for heavy in ("description", "romanization", "pronunciation_ko", "tip", "likely_allergens"):
        assert heavy not in item, f"목록에 무거운 필드 {heavy} 가 다시 들어왔다"
