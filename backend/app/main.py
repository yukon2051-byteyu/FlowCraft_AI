"""FastAPIアプリの入口。

起動方法（backend フォルダで）：
    .venv\\Scripts\\python.exe -m uvicorn app.main:app --reload
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import ENGINE_VERSION
from app.api import health


def create_app() -> FastAPI:
    app = FastAPI(title="FlowCraft AI API", version=ENGINE_VERSION)

    # 開発中はフロント（Vite: localhost:5173）から呼べるようにする。
    # 公開環境ではフロントを同じサーバーから配信するため、この許可は不要になる。
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router, prefix="/api")
    return app


app = create_app()
