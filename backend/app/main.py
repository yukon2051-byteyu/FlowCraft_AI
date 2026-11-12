"""FastAPIアプリの入口。

起動方法（backend フォルダで）：
    .venv\\Scripts\\python.exe -m uvicorn app.main:app --reload
"""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import ENGINE_VERSION
from app.api import health, session
from app.config import Settings, get_settings
from app.errors import install_error_handlers
from app.sessions.store import SessionStore

logger = logging.getLogger("flowcraft")


async def _purge_loop(store: SessionStore, interval_seconds: float) -> None:
    """期限切れのセッション（と、その中のデータ）を定期的に削除する。"""
    while True:
        await asyncio.sleep(interval_seconds)
        removed = store.purge_expired()
        if removed:
            logger.info("expired sessions purged: %d", removed)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    store = SessionStore(ttl_seconds=settings.session_ttl_minutes * 60, max_sessions=settings.max_sessions)

    @contextlib.asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        task = asyncio.create_task(_purge_loop(store, settings.session_purge_interval_seconds))
        try:
            yield
        finally:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    app = FastAPI(title="FlowCraft AI API", version=ENGINE_VERSION, lifespan=lifespan)
    app.state.session_store = store

    # 開発中はフロント（Vite: localhost:5173）から呼べるようにする。
    # 公開環境ではフロントを同じサーバーから配信するため、この許可は不要になる。
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    install_error_handlers(app)
    app.include_router(health.router, prefix="/api")
    app.include_router(session.router, prefix="/api")
    return app


app = create_app()
