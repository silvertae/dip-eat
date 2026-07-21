from __future__ import annotations

import logging
import time
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, Request, UploadFile
from starlette.concurrency import run_in_threadpool

from app.core.config import Settings, get_settings
from app.schemas.menu import MenuScanResponse, ScanMeta
from app.services.gemini import GeminiService
from app.services.image import prepare_image

log = logging.getLogger(__name__)
router = APIRouter(tags=["menu"])

CaptureMode = Literal["poster", "booklet", "kiosk"]


@router.post("/menu/scan", response_model=MenuScanResponse, summary="메뉴판 사진 1장 → 구조화된 메뉴")
async def scan_menu(
    request: Request,
    image: Annotated[UploadFile, File(description="메뉴판 사진 (JPEG/PNG/WEBP)")],
    mode: Annotated[CaptureMode, Form(description="촬영 모드")] = "poster",
    target_lang: Annotated[str, Form(description="번역 대상 언어")] = "ko",
) -> MenuScanResponse:
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
        outcome.input_tokens, outcome.output_tokens, outcome.thought_tokens, latency_ms,
    )

    return MenuScanResponse(
        **outcome.extraction.model_dump(),
        scan_id=uuid.uuid4().hex,
        meta=ScanMeta(model=outcome.model, latency_ms=latency_ms, image_px=prepared.px),
    )
