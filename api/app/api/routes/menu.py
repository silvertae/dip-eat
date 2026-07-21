from __future__ import annotations

import logging
import time
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, Request, UploadFile
from starlette.concurrency import run_in_threadpool

from app.core.config import Settings, get_settings
from app.schemas.menu import (
    ExplainRequest,
    ExplainResponse,
    MenuScanResponse,
    ScanMeta,
)
from app.services.gemini import GeminiService
from app.services.image import prepare_image

log = logging.getLogger(__name__)
router = APIRouter(tags=["menu"])

CaptureMode = Literal["poster", "booklet", "kiosk"]


@router.post("/menu/scan", response_model=MenuScanResponse, summary="메뉴판 사진 1장 → 메뉴 목록")
async def scan_menu(
    request: Request,
    image: Annotated[UploadFile, File(description="메뉴판 사진 (JPEG/PNG/WEBP)")],
    mode: Annotated[CaptureMode, Form(description="촬영 모드")] = "poster",
    target_lang: Annotated[str, Form(description="번역 대상 언어")] = "ko",
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
