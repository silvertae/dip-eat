"""진단 엔드포인트 테스트.

이 테스트가 지키는 것: **우리 스택은 버퍼링하지 않는다.**
그래야 실제 배포에서 줄이 뭉쳐서 오면 범인이 중간 프록시라고 단정할 수 있다.
"""

from __future__ import annotations

import json

import pytest


async def test_emits_requested_number_of_ndjson_lines(client_factory):
    async with client_factory() as c:
        resp = await c.get("/api/v1/_probe/stream", params={"chunks": 5, "delay_ms": 0})

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/x-ndjson")

    lines = [json.loads(line) for line in resp.text.splitlines() if line]
    assert [line["i"] for line in lines] == [0, 1, 2, 3, 4]
    assert lines[-1]["last"] is True
    assert all(not line["last"] for line in lines[:-1])


async def test_generator_yields_incrementally_not_all_at_once():
    """제너레이터가 게으르다는 증거 — 한 줄씩, 간격을 두고 내놓는다.

    ⚠️ HTTP 를 통과시켜 재지 않는 이유: `httpx.ASGITransport` 는 응답 본문을 전부
    모은 뒤에야 넘겨준다. 그래서 인프로세스 클라이언트로는 줄이 하나씩 오는지
    **증명할 수 없다**(전부 ~0.2ms 에 도착한 것처럼 보인다).

    우리가 코드로 보장할 수 있는 건 여기까지다. 프록시까지 포함한 종단 검증은
    실제 배포본에 curl 을 붙이는 수밖에 없고, 그게 바로 이 엔드포인트의 존재 이유다.
    """
    import time

    from app.api.routes.probe import _emit

    arrivals: list[float] = []
    started = time.perf_counter()
    async for _ in _emit(chunks=4, delay_ms=60, pad_bytes=0):
        arrivals.append(time.perf_counter() - started)

    assert len(arrivals) == 4
    # 간격 3회 × 60ms = 180ms. 한꺼번에 만들어 내보내면 전부 ~0초에 몰린다.
    assert arrivals[-1] - arrivals[0] > 0.1, f"줄이 한꺼번에 나왔다: {arrivals}"
    assert arrivals[0] < 0.05, "첫 줄은 즉시 나와야 한다"


async def test_server_elapsed_ms_grows_so_client_can_locate_the_buffering(client_factory):
    """각 줄의 server_elapsed_ms 가 단조 증가해야 범인 판별이 가능하다.

    배포 환경에서 줄이 뭉쳐 오더라도 이 값이 0,60,120... 이면 백엔드는 제때 뱉은
    것이므로 중간 프록시가 범인이라고 말할 수 있다.
    """
    async with client_factory() as c:
        resp = await c.get("/api/v1/_probe/stream", params={"chunks": 4, "delay_ms": 60})

    elapsed = [json.loads(line)["server_elapsed_ms"] for line in resp.text.splitlines() if line]
    assert elapsed == sorted(elapsed)
    assert elapsed[0] < 30
    assert elapsed[-1] >= 150  # 3 × 60ms 에서 스케줄링 오차를 뺀 값


async def test_pad_bytes_lets_us_test_a_minimum_buffer_threshold(client_factory):
    """평문은 막히는데 패딩을 키우면 뚫리는 프록시가 있다. 그걸 구분하기 위한 손잡이."""
    async with client_factory() as c:
        resp = await c.get(
            "/api/v1/_probe/stream", params={"chunks": 2, "delay_ms": 0, "pad_bytes": 1024}
        )

    lines = [json.loads(line) for line in resp.text.splitlines() if line]
    assert all(len(line["pad"]) == 1024 for line in lines)


@pytest.mark.parametrize(
    "params",
    [
        {"chunks": 0},
        {"chunks": 31},  # _MAX_CHUNKS 초과
        {"delay_ms": 1001},  # _MAX_DELAY_MS 초과
        {"pad_bytes": 8193},  # _MAX_PAD_BYTES 초과
    ],
)
async def test_limits_are_enforced(client_factory, params):
    """인증 없는 공개 엔드포인트다. 연결을 오래 붙잡아 동시성 슬롯을 소진시킬 수 없어야 한다."""
    async with client_factory() as c:
        resp = await c.get("/api/v1/_probe/stream", params=params)
    assert resp.status_code == 422


async def test_probe_is_not_in_the_public_openapi_contract(client_factory):
    """제품 계약이 아니다. openapi.json 에 새면 api.gen.ts 까지 오염된다."""
    async with client_factory() as c:
        schema = (await c.get("/openapi.json")).json()

    assert not [path for path in schema["paths"] if "_probe" in path]
