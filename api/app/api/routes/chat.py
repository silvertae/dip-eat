from __future__ import annotations

import logging
import time
from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, Request, UploadFile

from app.core.config import get_settings
from app.core.errors import AudioTooLarge, UnsupportedAudio
from app.schemas.chat import ChatRequest, ChatResponse, VoiceResponse
from app.services.gemini import GeminiService

log = logging.getLogger(__name__)
router = APIRouter(tags=["chat"])

Direction = Literal["ko2local", "local2ko"]
# 브라우저 MediaRecorder 가 내는 것들. content_type 이 위조 가능하지만 오디오는
# 이미지처럼 디코드 검증이 어려워, 최소한 오디오류인지만 본다.
_AUDIO_PREFIXES = ("audio/", "video/webm", "video/mp4")


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


@router.post("/chat/voice", response_model=VoiceResponse, summary="점원 대화 — 음성 받아쓰기 + 번역")
async def chat_voice(
    request: Request,
    audio: Annotated[UploadFile, File(description="짧은 발화 오디오 (webm/mp4/m4a 등)")],
    direction: Annotated[Direction, Form()],
    source_lang: Annotated[str, Form()] = "ja",
) -> VoiceResponse:
    """홀드-투-토크 녹음을 받아 Gemini 오디오로 전사+번역한다."""
    raw = await audio.read()
    if not raw:
        raise UnsupportedAudio("오디오가 비어 있어요.", detail="empty upload")
    if len(raw) > get_settings().max_audio_bytes:
        raise AudioTooLarge(detail=f"bytes={len(raw)}")
    mime = audio.content_type or "audio/webm"
    if not mime.startswith(_AUDIO_PREFIXES):
        raise UnsupportedAudio(detail=f"content_type={mime}")

    started = time.perf_counter()
    gemini: GeminiService = request.app.state.gemini
    outcome = await gemini.transcribe_and_translate(
        raw, mime, direction=direction, source_lang=source_lang
    )

    latency_ms = int((time.perf_counter() - started) * 1000)
    log.info(
        "chat.voice ok dir=%s bytes=%d model=%s latency_ms=%d",
        direction, len(raw), outcome.model, latency_ms,
    )
    return VoiceResponse(
        **outcome.result.model_dump(), model=outcome.model, latency_ms=latency_ms
    )
