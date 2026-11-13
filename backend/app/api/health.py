"""稼働確認API。サーバーが動いているか、どのモードで動いているかを返す。"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app import API_REVISION, ENGINE_VERSION
from app.config import Settings, get_settings

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: str
    engine_version: str
    ai_mode: str  # "live"（実AI） または "fixed"（固定応答）
    api_revision: int  # 画面が使うAPIの版（app/__init__.py の API_REVISION）


@router.get("/health", response_model=HealthResponse)
def health(settings: Settings = Depends(get_settings)) -> HealthResponse:
    return HealthResponse(
        status="ok",
        engine_version=ENGINE_VERSION,
        ai_mode="live" if settings.ai_enabled else "fixed",
        api_revision=API_REVISION,
    )
