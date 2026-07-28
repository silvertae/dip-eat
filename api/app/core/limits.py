"""업로드 크기 상한. **두 군데를 같이 올려야** 한다 — 하나만 올리면 다른 쪽에서 막힌다.

1) `BodySizeLimitMiddleware` — 전체 요청 본문의 총량. Content-Length 헤더는 위조 가능하므로
   스트리밍하면서 실제 바이트를 센다.
2) Starlette 멀티파트 파서의 `max_part_size` — 파트 하나의 상한, 기본 1MB.

(2)를 클래스 속성(`MultiPartParser.max_part_size`)으로 올리는 흔한 스니펫은 **동작하지 않는다.**
현행 Starlette 에서 `Request.form()` / `_get_form()` 이 `max_part_size: int = 1024 * 1024` 라는
하드코딩된 기본 인자를 파서에 넘기고, FastAPI 는 `await request.form()` 을 인자 없이 호출하기
때문이다(fastapi/routing.py). 그래서 `Request.form` 자체의 기본값을 바꾼다.
tests/test_upload_limits.py 가 이 동작을 지킨다 — Starlette 업그레이드 시 그 테스트를 볼 것.
"""

from __future__ import annotations

from collections.abc import Mapping

import starlette.requests
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.errors import DipeatError, PayloadTooLarge

_patched = False


def patch_multipart_part_limit(max_part_size: int) -> None:
    global _patched
    if _patched:
        return

    original_form = starlette.requests.Request.form

    def form(  # type: ignore[misc]
        self: starlette.requests.Request,
        *,
        max_files: int | float = 1000,
        max_fields: int | float = 1000,
        max_part_size: int = max_part_size,
    ):
        return original_form(
            self, max_files=max_files, max_fields=max_fields, max_part_size=max_part_size
        )

    starlette.requests.Request.form = form  # type: ignore[method-assign]
    _patched = True


class BodySizeLimitMiddleware:
    """본문 총량을 스트리밍하며 세다가 상한을 넘으면 413 을 돌려주는 순수 ASGI 미들웨어.

    ⚠️ 경로마다 상한이 다르다. 하나의 값으로 통일하면 둘 중 하나가 반드시 틀린다:
    큰 쪽에 맞추면 사진 상한이 조용히 풀리고, 작은 쪽에 맞추면 녹음이 사진 메시지로 거절된다.
    (실제로 운영 `DIPEAT_MAX_UPLOAD_BYTES=2MiB` 때문에 2~4MiB 녹음이 음성 화면에서
    "사진 용량이 너무 커요" 를 받고 있었다 — `AudioTooLarge` 가 도달 불가였다.)
    `overrides` 는 경로 접두사 → (상한, 에러 클래스). 메시지·코드는 errors.py 단일 출처를 쓴다.
    """

    def __init__(
        self,
        app: ASGIApp,
        *,
        max_bytes: int,
        overrides: Mapping[str, tuple[int, type[DipeatError]]] | None = None,
    ):
        self.app = app
        self.max_bytes = max_bytes
        self.overrides = dict(overrides or {})

    def _limit_for(self, path: str) -> tuple[int, type[DipeatError]]:
        for prefix, limit in self.overrides.items():
            if path.startswith(prefix):
                return limit
        return self.max_bytes, PayloadTooLarge

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        max_bytes, error = self._limit_for(scope.get("path", ""))
        received = 0
        exceeded = False

        async def counting_receive() -> Message:
            nonlocal received, exceeded
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > max_bytes:
                    exceeded = True
                    # 클라이언트가 계속 보내지 않도록 스트림을 끊는다.
                    return {"type": "http.disconnect"}
            return message

        async def guarded_send(message: Message) -> None:
            if exceeded:
                return
            await send(message)

        try:
            await self.app(scope, counting_receive, guarded_send)
        except Exception:
            # 스트림을 끊었으므로 앱이 ClientDisconnect 등을 던질 수 있다. 그건 우리가
            # 의도한 결과이므로 삼키고 413 을 돌려준다. 상한을 안 넘었다면 진짜 오류다.
            if not exceeded:
                raise

        if exceeded:
            await _send_413(send, max_bytes, error)


async def _send_413(send: Send, max_bytes: int, error: type[DipeatError]) -> None:
    import json

    body = json.dumps(
        {
            "code": error.code,
            "message": error.message,
            "detail": f"max_bytes={max_bytes}",
        },
        ensure_ascii=False,
    ).encode()
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json; charset=utf-8"),
                (b"content-length", str(len(body)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})
