from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import chat, health, menu
from app.core.config import get_settings
from app.core.errors import DipeatError
from app.core.limits import BodySizeLimitMiddleware, patch_multipart_part_limit

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logging.basicConfig(
        level=settings.log_level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    # 지연 import: 키가 없으면 GeminiService 가 즉시 실패하므로 여기서만 만든다.
    from app.services.gemini import GeminiService

    app.state.gemini = GeminiService(settings)
    log.info("startup model=%s fallback=%s", settings.gemini_model, settings.gemini_model_fallback)
    yield


def create_app() -> FastAPI:
    settings = get_settings()

    # 멀티파트 파트 상한(기본 1MB)을 총량 상한과 맞춰 올린다. app 생성 전에 해야 한다.
    patch_multipart_part_limit(settings.max_upload_bytes)

    app = FastAPI(
        title="dipeat API",
        version="0.1.0",
        description="찍먹 — 메뉴판 사진 한 장을 구조화된 메뉴로",
        lifespan=lifespan,
    )

    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_upload_bytes)
    # 프론트를 Vercel rewrites 뒤에 두면 동일 출처라 CORS 가 필요 없다. 이건 폴백이다.
    # allow_methods 기본값이 ("GET",) 이라 POST 프리플라이트가 조용히 깨진다 — 명시 필수.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
        allow_credentials=False,  # "*" 와 공존 불가. 쿠키를 안 쓰므로 False.
    )

    app.include_router(health.router, prefix="/api/v1")
    app.include_router(menu.router, prefix="/api/v1")
    app.include_router(chat.router, prefix="/api/v1")

    @app.exception_handler(DipeatError)
    async def dipeat_error_handler(_: Request, exc: DipeatError) -> JSONResponse:
        # 업스트림 예외가 그대로 클라이언트에 새지 않게 한 곳에서 매핑한다.
        # detail 은 항상 로그에 남기고, 응답에는 debug_errors 일 때만 싣는다.
        log.warning("handled error code=%s detail=%s", exc.code, exc.detail)
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "code": exc.code,
                "message": exc.message,
                "detail": exc.detail if settings.debug_errors else None,
            },
        )

    return app


app = create_app()
