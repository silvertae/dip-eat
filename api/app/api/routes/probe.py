"""스트리밍 통과 진단용 엔드포인트. **제품 기능이 아니다.**

메뉴 스캔은 지연이 거의 전부 출력 토큰에서 나온다(실측: 9,243토큰 / 34.5초 ≈ 268 tok/s).
항목이 JSON 배열에 순서대로 완성되므로, 스트리밍하면 첫 카드를 ~0.7초에 보여줄 수 있다.

그런데 그 설계는 **Vercel 리라이트 프록시가 청크를 그대로 흘려보낼 때만** 성립한다.
프록시가 응답을 다 모았다가 한 번에 뱉으면 백엔드가 아무리 스트리밍해도 브라우저는
34초 뒤에 통째로 받는다. 프록시 계층의 스트리밍 버퍼링은 실제로 흔한 문제다.

그래서 스트리밍 구현에 착수하기 **전에** 이 엔드포인트로 경로를 먼저 검증한다.
Gemini 를 부르지 않으므로 비용이 0이고, 실패해도 프로덕션 경로에 영향이 없다.

검증 방법은 docs/deploy.md "부록 A" 참고.

⚠️ 결론이 나면 이 파일과 main.py 의 라우터 등록을 지운다.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

router = APIRouter(tags=["probe"])

# 상한을 둔다: 인증 없는 공개 엔드포인트이고, 열려 있는 동안 Cloud Run 동시성 슬롯
# (--concurrency 8)을 하나 잡아먹는다. 최악 30 × 1,000ms = 30초로 묶어
# --timeout 105 에 한참 못 미치게 한다.
_MAX_CHUNKS = 30
_MAX_DELAY_MS = 1_000
_MAX_PAD_BYTES = 8_192


async def _emit(chunks: int, delay_ms: float, pad_bytes: int) -> AsyncIterator[bytes]:
    started = time.perf_counter()
    # 패딩은 "최소 버퍼 크기를 못 채워서 안 나오는" 경우를 구분하려고 넣는다.
    # 평문 줄이 막히는데 pad 를 키우면 뚫린다면, 원인은 경로가 아니라 버퍼 임계값이다.
    pad = "x" * pad_bytes

    for i in range(chunks):
        if i:
            await asyncio.sleep(delay_ms / 1000)
        line = {
            "i": i,
            "server_elapsed_ms": round((time.perf_counter() - started) * 1000),
            "last": i == chunks - 1,
        }
        if pad_bytes:
            line["pad"] = pad
        # NDJSON: 한 줄 = 한 이벤트. SSE 와 달리 파서가 필요 없어 curl 로 바로 읽힌다.
        yield (json.dumps(line, separators=(",", ":")) + "\n").encode()


@router.get(
    "/_probe/stream",
    summary="[진단] 스트리밍이 프록시를 통과하는지 확인",
    include_in_schema=False,  # 제품 계약이 아니므로 openapi.json 에 넣지 않는다
)
async def probe_stream(
    chunks: int = Query(10, ge=1, le=_MAX_CHUNKS),
    delay_ms: float = Query(500, ge=0, le=_MAX_DELAY_MS),
    pad_bytes: int = Query(0, ge=0, le=_MAX_PAD_BYTES),
) -> StreamingResponse:
    """`delay_ms` 간격으로 `chunks` 줄을 NDJSON 으로 흘린다.

    각 줄에 서버 기준 경과 시간(`server_elapsed_ms`)이 들어 있다.
    클라이언트 도착 간격과 비교하면 어디서 막혔는지가 드러난다:

    - 줄이 하나씩 도착 → 경로가 스트리밍을 통과한다. 구현해도 된다.
    - 마지막에 전부 한꺼번에 도착 → 어딘가 버퍼링한다. `server_elapsed_ms` 는
      0, 500, 1000... 으로 정상이므로 백엔드가 아니라 **중간 프록시**가 범인이다.
    """
    return StreamingResponse(
        _emit(chunks, delay_ms, pad_bytes),
        media_type="application/x-ndjson",
        headers={
            # Content-Length 가 없어야 청크 전송이 된다(StreamingResponse 가 알아서 뺀다).
            "Cache-Control": "no-store, no-transform",
            # nginx 계열 역프록시의 응답 버퍼링을 끄는 관용 헤더. Vercel 이 이걸 보는지도
            # 이 실험으로 같이 확인된다.
            "X-Accel-Buffering": "no",
        },
    )
