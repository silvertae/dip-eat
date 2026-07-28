from __future__ import annotations

import json
import logging
import time
import uuid
from collections.abc import AsyncIterator
from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import TypeAdapter, ValidationError
from starlette.concurrency import run_in_threadpool

from app.core.config import Settings, get_settings
from app.core.errors import DipeatError, InvalidRequest
from app.schemas.menu import (
    ExplainRequest,
    ExplainResponse,
    ItemBox,
    LocateResponse,
    LocateTarget,
    MenuScanResponse,
    ScanMeta,
)
from app.services.gemini import GeminiService, ScanHead, ScanTail
from app.services.image import prepare_image

# 장바구니의 몇 개뿐이라 상한이 넉넉하다. 이게 없으면 targets 하나로 프롬프트를
# 임의 크기까지 부풀릴 수 있다(무인증 엔드포인트 + 비싼 locate 모델).
_MAX_LOCATE_TARGETS = 30
_TARGETS_ADAPTER = TypeAdapter(list[LocateTarget])

log = logging.getLogger(__name__)
router = APIRouter(tags=["menu"])

CaptureMode = Literal["poster", "booklet", "kiosk"]


@router.post("/menu/scan", response_model=MenuScanResponse, summary="메뉴판 사진 1장 → 메뉴 목록")
async def scan_menu(
    request: Request,
    image: Annotated[UploadFile, File(description="메뉴판 사진 (JPEG/PNG/WEBP)")],
    mode: Annotated[CaptureMode, Form(description="촬영 모드")] = "poster",
) -> MenuScanResponse:
    """목록에 필요한 것만 반환한다. 긴 설명·알레르기 근거는 `/menu/item/explain` 으로."""
    settings: Settings = get_settings()
    started = time.perf_counter()

    raw = await image.read()

    # Pillow 디코드/리사이즈는 블로킹 CPU 작업. asyncio.to_thread 가 아니라 run_in_threadpool 을
    # 쓴다 — AnyIO 의 공용 CapacityLimiter 를 타야 FastAPI 전체와 백프레셔를 공유한다.
    prepared = await run_in_threadpool(
        prepare_image,
        raw,
        target_long_edge=settings.target_long_edge,
        jpeg_quality=settings.jpeg_quality,
    )

    gemini: GeminiService = request.app.state.gemini
    outcome = await gemini.extract_menu(prepared, mode=mode)

    latency_ms = int((time.perf_counter() - started) * 1000)
    # 출력 토큰이 이 엔드포인트 지연의 지배적 요인이라 반드시 같이 남긴다.
    log.info(
        "menu.scan ok items=%d model=%s px=%s bytes_in=%d bytes_sent=%d "
        "tok_in=%d tok_out=%d tok_think=%d latency_ms=%d",
        len(outcome.extraction.items), outcome.model, prepared.px, len(raw), len(prepared.data),
        outcome.usage.input_tokens, outcome.usage.output_tokens, outcome.usage.thought_tokens,
        latency_ms,
    )

    return MenuScanResponse(
        **outcome.extraction.model_dump(),
        scan_id=uuid.uuid4().hex,
        meta=ScanMeta(model=outcome.model, latency_ms=latency_ms, image_px=prepared.px),
    )


@router.post(
    "/menu/scan/stream",
    summary="메뉴판 사진 1장 → 메뉴 목록 (NDJSON 스트리밍)",
    response_class=StreamingResponse,
    # 스트림은 한 줄마다 형태가 달라 response_model 로 표현할 수 없다. 계약은 아래 docstring 과
    # web/src/lib/api.ts 의 파서가 함께 지킨다. openapi 에 반쪽짜리 스키마를 넣지 않는다.
    include_in_schema=False,
)
async def scan_menu_stream(
    request: Request,
    image: Annotated[UploadFile, File(description="메뉴판 사진 (JPEG/PNG/WEBP)")],
    mode: Annotated[CaptureMode, Form(description="촬영 모드")] = "poster",
) -> StreamingResponse:
    """`/menu/scan` 과 같은 결과를 항목이 완성되는 대로 흘려보낸다.

    한 줄 = 한 이벤트(NDJSON). 순서는 항상 `meta` → `item`* → `done`:

        {"type":"meta","scan_id":"...","source_lang":"ja","currency":"JPY","restaurant":{...}}
        {"type":"item","item":{...MenuItemSummary...}}
        {"type":"done","warnings":[],"meta":{"model":"...","latency_ms":123,"image_px":"..."}}

    실패는 `{"type":"error","code":"...","message":"...","partial":bool}` 한 줄로 끝난다.
    `partial=true` 면 앞서 보낸 항목들은 유효하다.

    ⚠️ **HTTP 상태는 항상 200 이다.** 첫 바이트를 보내는 순간 상태 코드가 확정되므로,
    생성 도중 난 오류를 4xx/5xx 로 바꿀 방법이 없다. 그래서 오류도 본문 안에서 전달한다.
    클라이언트는 상태 코드가 아니라 `type` 을 봐야 한다.
    """
    settings: Settings = get_settings()
    started = time.perf_counter()

    raw = await image.read()
    prepared = await run_in_threadpool(
        prepare_image,
        raw,
        target_long_edge=settings.target_long_edge,
        jpeg_quality=settings.jpeg_quality,
    )

    gemini: GeminiService = request.app.state.gemini
    scan_id = uuid.uuid4().hex

    async def emit() -> AsyncIterator[bytes]:
        sent_items = 0
        try:
            async for event in gemini.stream_menu(prepared, mode=mode):
                if isinstance(event, ScanHead):
                    yield _line(
                        {
                            "type": "meta",
                            "scan_id": scan_id,
                            "source_lang": event.source_lang,
                            "currency": event.currency,
                            "restaurant": event.restaurant.model_dump(),
                        }
                    )
                elif isinstance(event, ScanTail):
                    latency_ms = int((time.perf_counter() - started) * 1000)
                    log.info(
                        "menu.scan.stream ok items=%d model=%s px=%s bytes_in=%d "
                        "tok_in=%d tok_out=%d latency_ms=%d",
                        event.items, event.model, prepared.px, len(raw),
                        event.usage.input_tokens, event.usage.output_tokens, latency_ms,
                    )
                    yield _line(
                        {
                            "type": "done",
                            "warnings": event.warnings,
                            "meta": ScanMeta(
                                model=event.model,
                                latency_ms=latency_ms,
                                image_px=prepared.px,
                            ).model_dump(),
                        }
                    )
                else:
                    sent_items += 1
                    yield _line({"type": "item", "item": event.model_dump()})
        except DipeatError as exc:
            # 스트림 도중이라 상태 코드를 못 바꾼다. 본문으로 알린다.
            log.warning(
                "menu.scan.stream failed code=%s sent=%d detail=%s",
                exc.code, sent_items, exc.detail,
            )
            yield _line(
                {
                    "type": "error",
                    "code": exc.code,
                    "message": exc.message,
                    "partial": sent_items > 0,
                }
            )
        except Exception:
            # ⚠️ DipeatError 만 잡으면 그 밖의 예외가 제너레이터 밖으로 나가고,
            #    Starlette 는 이미 시작된 응답을 줄 중간에서 끊어버린다. 그러면 위 docstring 이
            #    선언한 "실패는 error 한 줄로 끝난다" 가 지켜지지 않고, 클라이언트는 done 도
            #    error 도 못 본 채 일반 네트워크 오류로 처리한다. 계약은 예외 없이 지킨다.
            log.exception("menu.scan.stream crashed sent=%d", sent_items)
            yield _line(
                {
                    "type": "error",
                    "code": "internal_error",
                    "message": "일시적인 오류가 발생했어요. 다시 시도해주세요.",
                    "partial": sent_items > 0,
                }
            )

    return StreamingResponse(
        emit(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-store, no-transform",
            # 중간 프록시의 응답 버퍼링을 끈다. 이게 없으면 스트리밍이 무의미해진다.
            "X-Accel-Buffering": "no",
        },
    )


def _line(payload: dict) -> bytes:
    """NDJSON 한 줄. ensure_ascii=False 라야 일본어가 이스케이프로 부풀지 않는다."""
    return (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode()


@router.post(
    "/menu/item/explain",
    response_model=ExplainResponse,
    summary="메뉴 1개의 상세 설명 (카드를 탭했을 때)",
)
async def explain_item(request: Request, body: ExplainRequest) -> ExplainResponse:
    """사진을 다시 보내지 않는다 — 텍스트 전용이라 목록 호출보다 훨씬 싸고 빠르다.

    클라이언트는 결과를 scan_id 와 함께 캐시해서 같은 메뉴를 두 번 묻지 않는다.
    """
    started = time.perf_counter()
    gemini: GeminiService = request.app.state.gemini
    outcome = await gemini.explain_item(body)

    latency_ms = int((time.perf_counter() - started) * 1000)
    log.info(
        "menu.explain ok name=%r model=%s tok_out=%d latency_ms=%d",
        body.name_local, outcome.model, outcome.usage.output_tokens, latency_ms,
    )

    return ExplainResponse(
        **outcome.explanation.model_dump(),
        name_local=body.name_local,
        model=outcome.model,
        latency_ms=latency_ms,
    )


@router.post(
    "/menu/locate",
    response_model=LocateResponse,
    summary="장바구니 항목을 메뉴판 사진 위에서 찾기 (사진에서 확인 탭)",
)
async def locate_items(
    request: Request,
    image: Annotated[UploadFile, File(description="메뉴판 사진 (스캔 때와 같은 축소본)")],
    targets: Annotated[
        str,
        Form(description='찾을 항목 JSON. 예: [{"index":1,"name_local":"ラフテー","section":"돼지고기 요리"}]'),
    ],
) -> LocateResponse:
    """사용자가 '사진에서 확인' 탭을 열 때만 호출한다. 대상은 장바구니의 몇 개뿐이라
    목록 스캔처럼 항목 수로 곱해지지 않는다. 좌표는 Gemini 네이티브 0~1000 을 받아 0~1 로 변환해 내려준다.
    """
    settings: Settings = get_settings()
    started = time.perf_counter()

    # targets 는 멀티파트 폼 필드라 Pydantic 리스트로 자동 바인딩되지 않는다 — JSON 문자열을 직접 검증한다.
    try:
        parsed_targets = _TARGETS_ADAPTER.validate_json(targets)
    except ValidationError as exc:
        raise InvalidRequest(detail=f"bad targets: {exc}") from exc
    if not parsed_targets:
        raise InvalidRequest(detail="empty targets")
    if len(parsed_targets) > _MAX_LOCATE_TARGETS:
        raise InvalidRequest(detail=f"too many targets: {len(parsed_targets)}")

    raw = await image.read()
    prepared = await run_in_threadpool(
        prepare_image,
        raw,
        target_long_edge=settings.target_long_edge,
        jpeg_quality=settings.jpeg_quality,
    )

    gemini: GeminiService = request.app.state.gemini
    outcome = await gemini.locate_items(prepared, parsed_targets)

    def norm(v: int) -> float:
        # 0~1000 → 0~1. 모델이 범위를 벗어난 값을 줄 수 있어 방어적으로 clamp.
        return min(1.0, max(0.0, v / 1000.0))

    boxes = [
        ItemBox(
            index=b.index,
            name_local=b.name_local,
            found=b.found,
            x=norm(b.xmin),
            y=norm(b.ymin),
            w=max(0.0, norm(b.xmax) - norm(b.xmin)),
            h=max(0.0, norm(b.ymax) - norm(b.ymin)),
        )
        for b in outcome.result.boxes
    ]

    latency_ms = int((time.perf_counter() - started) * 1000)
    log.info(
        "menu.locate ok targets=%d found=%d model=%s px=%s tok_in=%d tok_out=%d latency_ms=%d",
        len(parsed_targets), sum(1 for b in boxes if b.found), outcome.model, prepared.px,
        outcome.usage.input_tokens, outcome.usage.output_tokens, latency_ms,
    )

    return LocateResponse(boxes=boxes, model=outcome.model, latency_ms=latency_ms)
