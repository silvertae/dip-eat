"""위치 찾기(3단계) 엔드포인트.

'사진에서 확인' 탭이 부른다. 사진을 다시 보내지만 대상은 장바구니의 몇 개뿐이라
목록 스캔처럼 항목 수로 곱해지지 않는다. 좌표는 Gemini 네이티브 0~1000 을 0~1 로 변환해 내려준다.
"""

from __future__ import annotations

import json

from app.core.errors import UpstreamTimeout
from tests.conftest import FakeGemini, make_jpeg

TARGETS = [
    {"index": 1, "name_local": "ラフテー", "section": "돼지고기 요리"},
    {"index": 2, "name_local": "ゴーヤーチャンプルー", "section": ""},
]


async def _post(client, targets=TARGETS):
    return await client.post(
        "/api/v1/menu/locate",
        files={"image": ("m.jpg", make_jpeg(), "image/jpeg")},
        data={"targets": json.dumps(targets)},
    )


async def test_locate_returns_normalized_boxes(client_factory):
    async with client_factory() as client:
        resp = await _post(client)

    assert resp.status_code == 200
    body = resp.json()
    boxes = body["boxes"]
    assert len(boxes) == len(TARGETS)  # 요청한 만큼 되돌아온다(못 찾은 것 포함)

    b0 = boxes[0]
    assert b0["found"] is True
    assert b0["index"] == 1 and b0["name_local"] == "ラフテー"  # index·name_local echo
    for k in ("x", "y", "w", "h"):
        assert 0.0 <= b0[k] <= 1.0  # 정규화 범위
    # 0~1000 → 0~1 변환 (xmin=80, xmax=760 → x .08, w .68)
    assert abs(b0["x"] - 0.08) < 1e-6
    assert abs(b0["y"] - 0.13) < 1e-6
    assert abs(b0["w"] - 0.68) < 1e-6

    assert boxes[1]["found"] is False  # 못 찾은 항목도 found=false 로 포함
    assert body["latency_ms"] >= 0


async def test_locate_upstream_failure_is_mapped(client_factory):
    async with client_factory(FakeGemini(error=UpstreamTimeout())) as client:
        resp = await _post(client)
    assert resp.status_code == 504
    assert resp.json()["code"] == "upstream_timeout"


async def test_locate_requires_targets(client_factory):
    async with client_factory() as client:
        resp = await _post(client, targets=[])
    assert resp.status_code == 422
    assert resp.json()["code"] == "invalid_request"


async def test_locate_rejects_bad_targets_json(client_factory):
    async with client_factory() as client:
        resp = await client.post(
            "/api/v1/menu/locate",
            files={"image": ("m.jpg", make_jpeg(), "image/jpeg")},
            data={"targets": "not json"},
        )
    assert resp.status_code == 422
    assert resp.json()["code"] == "invalid_request"
