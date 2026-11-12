"""FastAPIアプリの入口。

起動方法（backend フォルダで）：
    .venv\\Scripts\\python.exe -m uvicorn app.main:app --reload
"""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app import ENGINE_VERSION
from app.api import files, flows, health, session
from app.config import Settings, get_settings
from app.errors import AppError, install_error_handlers
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

    # アップロードの送信サイズを、本文を受け取る前に確認する（巨大な送信でメモリ・ディスクを使わせない）
    upload_limit = settings.max_file_size_mb * 1024 * 1024 + 64 * 1024  # 送信形式の付帯情報ぶんの余裕

    @app.middleware("http")
    async def limit_upload_size(request: Request, call_next):  # type: ignore[no-untyped-def]
        if request.method == "POST" and request.url.path == "/api/files":
            length = request.headers.get("content-length")
            if length is None or not length.isdigit():
                err = AppError(411, "LENGTH_REQUIRED", "送信サイズが不明なため受け付けられません。", how_to_fix="画面からファイルを選び直してください。")
                return JSONResponse(status_code=411, content=err.to_body())
            if int(length) > upload_limit:
                err = AppError(
                    413,
                    "FILE_TOO_LARGE",
                    f"ファイルのサイズが上限（{settings.max_file_size_mb}MB）を超えています。",
                    how_to_fix="不要な行・列・シートを削除して、ファイルを小さくしてください。",
                )
                return JSONResponse(status_code=413, content=err.to_body())
        return await call_next(request)

    install_error_handlers(app)
    app.include_router(health.router, prefix="/api")
    app.include_router(session.router, prefix="/api")
    app.include_router(files.router, prefix="/api")
    app.include_router(flows.router, prefix="/api")
    return app


app = create_app()
