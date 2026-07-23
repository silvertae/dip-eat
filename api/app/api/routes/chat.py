from __future__ import annotations

import logging
import time

from fastapi import APIRouter, Request

from app.schemas.chat import ChatRequest, ChatResponse
from app.services.gemini import GeminiService

log = logging.getLogger(__name__)
router = APIRouter(tags=["chat"])


@router.post("/chat", response_model=ChatResponse, summary="점원 대화 — 자유 발화 번역")
async def chat(request: Request, body: ChatRequest) -> ChatResponse:
    """주문 '카드'는 서버를 부르지 않는다(오프라인 조립). 이건 자유 발화 번역 전용이다."""
    started = time.perf_counter()
    gemini: GeminiService = request.app.state.gemini
    outcome = await gemini.translate(body)

    latency_ms = int((time.perf_counter() - started) * 1000)
    log.info(
        "chat.translate ok dir=%s len=%d model=%s latency_ms=%d",
        body.direction, len(body.text), outcome.model, latency_ms,
    )
    return ChatResponse(
        **outcome.translation.model_dump(), model=outcome.model, latency_ms=latency_ms
    )
