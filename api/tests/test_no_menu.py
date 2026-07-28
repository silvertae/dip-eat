"""메뉴판이 없는 사진에 메뉴를 지어내지 못하게 막는 가드.

## 왜 이 파일이 있나

실측(gemini-3.1-flash-lite, mode=poster): 600×400 흰 JPEG 한 장에 `生ビール 550円`,
`枝豆 350円` 같은 **완전히 지어낸 항목 8개**가 `ocr_confidence: "high"` 로 돌아왔다.
회색 단색 8개, 어두운 프레임 5개. 스트림은 meta → item → done 으로 멀쩡히 끝났고
HTTP 200 에 warnings 도 비어 있었다 — 어디에서도 이상 신호가 나지 않았다.

기존 가드가 왜 못 잡았나:
  - `items` 가 0개일 때만 도는 분기(`count == 0` / `if not parsed.items`)인데 모델이
    항목을 가득 채워 보내므로 절대 안 걸린다.
  - `ocr_confidence` 는 항목을 지어낸 그 모델이 스스로 매긴 값이라 증거가 못 된다.

그래서 **모델이 항목을 쓰기 전에 '메뉴판이 있다/없다'를 먼저 선언**하게 만들고
(`MenuExtraction.menu_found`, 스키마상 `items` 앞), 서버가 그 선언을 강제한다.

이 파일은 **서버 계약**만 본다(네트워크 없음). 실제 모델이 빈 사진에 false 를 다는지는
`test_no_menu_live.py` 가 실 API 로 확인한다.
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from app.core.config import Settings
from app.core.errors import NoMenuFound, UnreadableMenu
from app.schemas.menu import MenuExtraction
from app.services.gemini import GeminiService, ScanHead, ScanTail
from app.services.jsonstream import MenuStreamParser
from tests.conftest import FakeGemini, make_jpeg, sample_extraction
from tests.test_gemini_service import IMAGE, build_service, ok_response


def events(body: str) -> list[dict]:
    return [json.loads(line) for line in body.splitlines() if line.strip()]


# --- 스키마 불변식 -------------------------------------------------------------


def test_menu_found_is_declared_before_items_in_the_gemini_schema():
    """필드 순서가 곧 Gemini 의 `property_ordering` 이다. 이게 깨지면 가드 전체가 무의미해진다.

    `items` 뒤로 밀리면 (a) 모델이 항목을 다 지어낸 뒤에야 판정을 쓰게 되고
    (b) 스트리밍에서 첫 항목이 이미 나간 뒤에나 값을 읽을 수 있다.
    """
    order = list(MenuExtraction.model_json_schema()["properties"])
    assert order.index("menu_found") < order.index("items")
    assert order.index("no_menu_reason") < order.index("items")


def test_no_menu_found_reuses_the_retry_path():
    """어두운 실사 메뉴판을 오판할 수 있으므로 상위 모델에게 한 번 더 물어봐야 한다.

    `_with_fallback` / `stream_menu` 는 `UnreadableMenu` 를 잡아 폴백한다. 상속을 끊으면
    폴백 없이 곧장 사용자에게 나가고, 어려운 사진의 성공률이 떨어진다.
    """
    assert issubclass(NoMenuFound, UnreadableMenu)
    assert NoMenuFound.status_code == 422
    assert NoMenuFound.code == "no_menu_found"


# --- 서비스: 비스트리밍 --------------------------------------------------------


def no_menu_extraction(items: int = 0) -> MenuExtraction:
    base = sample_extraction()
    return base.model_copy(
        update={
            "menu_found": False,
            "no_menu_reason": "아무것도 없는 흰 화면이에요",
            "items": base.items * items,
        }
    )


async def test_menu_found_false_is_rejected_even_when_items_are_full():
    """⚠️ 이 파일의 핵심. 모델은 '메뉴판 없음'을 선언하고도 항목을 채워 보낼 수 있다.

    그때 항목을 믿으면 지어낸 메뉴가 그대로 사용자에게 간다. 기존 `if not parsed.items`
    가드는 항목이 있으므로 통과시킨다.
    """
    fabricated = no_menu_extraction(items=1)
    assert fabricated.items, "픽스처 전제: 항목이 채워져 있어야 이 테스트가 의미 있다"

    service, used = build_service([ok_response(fabricated)] * 4)
    with pytest.raises(NoMenuFound):
        await service.extract_menu(IMAGE, mode="poster")
    assert len(used) == 4  # 모델 2개 × 시도 2회 — 오판 가능성 때문에 상위 모델까지 물어본다


async def test_a_real_menu_on_the_fallback_model_still_wins():
    """1차가 '메뉴 없음'이라 해도 상위 모델이 읽어내면 성공해야 한다.

    이게 없으면 빈 사진을 막는 대신 어려운 실사 메뉴판을 잃는다 — 버그보다 나쁜 수정.
    """
    service, used = build_service(
        [ok_response(no_menu_extraction())] * 2 + [ok_response(sample_extraction())]
    )
    outcome = await service.extract_menu(IMAGE, mode="poster")
    assert outcome.extraction.items[0].name_local == "ラフテー"
    assert outcome.model == used[2] != used[0]


# --- 서비스: 스트리밍 ----------------------------------------------------------


def stream_service(chunk_sets: list[list[str]]) -> GeminiService:
    """`chunk_sets[i]` 를 i 번째 모델 호출의 청크 스트림으로 돌려주는 가짜 SDK."""
    service = GeminiService(Settings(gemini_api_key="test-key", gemini_max_attempts=2))
    queue = list(chunk_sets)

    async def fake_stream(*, model: str, contents, config):
        chunks = queue.pop(0)

        async def gen():
            for text in chunks:
                yield SimpleNamespace(text=text, usage_metadata=None)

        return gen()

    service._client = SimpleNamespace(  # type: ignore[assignment]
        aio=SimpleNamespace(models=SimpleNamespace(generate_content_stream=fake_stream))
    )
    return service


def fabricated_stream_json() -> str:
    """모델이 '메뉴판 없음'을 선언하고도 항목을 지어낸 응답 전문."""
    item = sample_extraction().items[0].model_dump()
    return json.dumps(
        {
            "menu_found": False,
            "no_menu_reason": "아무것도 없는 흰 화면이에요",
            "source_lang": "ja",
            "currency": "JPY",
            "restaurant": {"name_local": "", "name_translated": "", "cuisine_hint": ""},
            "items": [item, item],
            "warnings": [],
        },
        ensure_ascii=False,
    )


@pytest.mark.parametrize("chunk_size", [1, 7, 4096])
async def test_stream_emits_nothing_when_the_model_says_there_is_no_menu(chunk_size: int):
    """항목이 한 개도 나가기 전에 끊겨야 한다 — 나간 카드는 되돌릴 수 없다.

    조각 경계가 어디에 떨어져도 같아야 하므로 청크 크기를 바꿔가며 확인한다.
    """
    body = fabricated_stream_json()
    chunks = [body[i : i + chunk_size] for i in range(0, len(body), chunk_size)]
    service = stream_service([chunks, chunks])  # 1차 + 폴백 둘 다 같은 응답

    collected = []
    with pytest.raises(NoMenuFound):
        async for event in service.stream_menu(IMAGE, mode="poster"):
            collected.append(event)

    assert collected == [], f"지어낸 항목이 새어 나갔다: {collected}"


async def test_stream_falls_back_and_serves_a_real_menu():
    """1차가 '메뉴 없음'이어도 폴백이 읽어내면 정상 스트림이 나가야 한다."""
    real = sample_extraction()
    good = json.dumps(
        {
            "menu_found": True,
            "no_menu_reason": "",
            "source_lang": "ja",
            "currency": "JPY",
            "restaurant": real.restaurant.model_dump(),
            "items": [i.model_dump() for i in real.items],
            "warnings": [],
        },
        ensure_ascii=False,
    )
    service = stream_service([[fabricated_stream_json()], [good]])

    events_out = [e async for e in service.stream_menu(IMAGE, mode="poster")]
    assert isinstance(events_out[0], ScanHead)
    assert isinstance(events_out[-1], ScanTail)
    assert [e.name_local for e in events_out[1:-1]] == ["ラフテー"]


def test_parser_head_carries_menu_found_before_any_item():
    """스트리밍 가드는 `parser.head` 에 이 값이 실려 오는 데 전적으로 기댄다."""
    parser = MenuStreamParser()
    prefix = '{"menu_found":false,"no_menu_reason":"흰 화면","source_lang":"ja",'
    prefix += '"currency":"JPY","restaurant":{"name_local":"","name_translated":"",'
    prefix += '"cuisine_hint":""},"items":['

    assert parser.feed(prefix) == []  # 아직 완성된 항목이 없다
    assert parser.head is not None
    assert parser.head["menu_found"] is False
    assert parser.head["no_menu_reason"] == "흰 화면"


# --- 라우트 계약 ---------------------------------------------------------------


async def test_scan_route_maps_no_menu_to_422(client_factory):
    async with client_factory(FakeGemini(error=NoMenuFound())) as client:
        resp = await client.post(
            "/api/v1/menu/scan", files={"image": ("m.jpg", make_jpeg(), "image/jpeg")}
        )

    assert resp.status_code == 422
    body = resp.json()
    assert body["code"] == "no_menu_found"
    # '못 읽었다'가 아니라 '메뉴판이 안 보인다'로 안내해야 사용자가 다시 찍을 수 있다.
    assert "메뉴판" in body["message"]


async def test_stream_route_reports_no_menu_as_an_error_line_with_no_items(client_factory):
    """스트림은 이미 200 으로 시작했다. 오류는 본문으로 오되 item 줄은 하나도 없어야 한다."""
    async with client_factory(FakeGemini(error=NoMenuFound())) as client:
        resp = await client.post(
            "/api/v1/menu/scan/stream", files={"image": ("m.jpg", make_jpeg(), "image/jpeg")}
        )

    assert resp.status_code == 200
    lines = events(resp.text)
    assert [line["type"] for line in lines] == ["error"]
    assert lines[0]["code"] == "no_menu_found"
    assert lines[0]["partial"] is False
    assert "메뉴판" in lines[0]["message"]


async def test_negative_fixtures_survive_the_image_pipeline(client_factory):
    """단색·저용량 사진이 이미지 단계에서 먼저 튕기면 위 가드를 시험할 기회조차 없다.

    (모델 거동이 아니라 파이프라인 통과만 본다 — 실제 판정은 test_no_menu_live.py)
    """
    from tests.conftest import NO_MENU_FIXTURES

    fake = FakeGemini()
    async with client_factory(fake) as client:
        for name, make in NO_MENU_FIXTURES.items():
            resp = await client.post(
                "/api/v1/menu/scan",
                files={"image": (f"{name}.jpg", make(), "image/jpeg")},
            )
            assert resp.status_code == 200, f"{name}: {resp.text[:200]}"

    assert len(fake.calls) == len(NO_MENU_FIXTURES)
