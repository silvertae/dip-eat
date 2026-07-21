# Cloud Run 용 2-stage 빌드.
#
# 빌드팩(`gcloud run deploy --source .` 에 Dockerfile 이 없을 때)을 쓰지 않는 이유:
# Python 3.12 이하 빌드팩은 `gunicorn main:app`(WSGI)로 떨어져 ASGI 인 FastAPI 가
# 알아보기 힘든 에러로 죽는다. 발표 전날 자동 감지에 맡길 일이 아니다.

FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# 의존성 레이어를 소스와 분리해 캐시가 살아 있도록 한다.
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-install-project --no-dev

COPY . /app
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev


FROM python:3.13-slim-bookworm

# 컴파일러를 최종 이미지에 남기지 않는다 → 이미지가 작고 콜드스타트가 빠르다.
COPY --from=builder /app /app

WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

# Cloud Run 은 $PORT 로 포트를 주입한다. 0.0.0.0 바인딩 필수.
ENV PORT=8080
EXPOSE 8080
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
