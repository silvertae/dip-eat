from fastapi import APIRouter
from pydantic import BaseModel

from app.core.config import get_settings

router = APIRouter(tags=["health"])


class Health(BaseModel):
    status: str
    model: str
    has_api_key: bool


@router.get("/health", summary="헬스체크 + Cloud Run 워밍업")
async def health() -> Health:
    """발표 직전 이 엔드포인트를 한 번 때려 인스턴스를 깨워둔다."""
    settings = get_settings()
    return Health(
        status="ok",
        model=settings.gemini_model,
        has_api_key=bool(settings.resolved_api_key),
    )
