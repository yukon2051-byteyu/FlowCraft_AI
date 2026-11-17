"""組み立て済みの画面（frontend の vite build の結果）を、このサーバーから配信する（公開環境用）。

公開環境では、画面とサーバーを1つのコンテナで動かす（docs/architecture.md）。開発中は Vite の開発用サーバーが画面を配信するので使わない。
  - 設定 FRONTEND_DIST に、組み立てた画面のフォルダ（index.html がある所）を指定したときだけ有効
  - /assets/... などの実在するファイルは、そのまま返す（名前に内容の指紋が入っているので、長く保存させる）
  - 画面のURL（/build など）は index.html を返す（画面側で表示を切り替える方式のため）。index.html は保存させない（新しい版をすぐ使わせる）
  - /api/... は配信しない（窓口が見つからないときは、画面ではなくエラーを返す）
  - 配信フォルダの外のファイルは返さない（../ などの細工を防ぐ）
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse

from app.errors import AppError


def install_frontend(app: FastAPI, dist: str) -> None:
    root = Path(dist).resolve()
    index = root / "index.html"
    if not index.is_file():
        raise RuntimeError(f"画面の入り口（index.html）が見つかりません：{index}")

    @app.get("/{path:path}", include_in_schema=False)
    async def frontend(path: str, request: Request):  # type: ignore[no-untyped-def]
        if path == "api" or path.startswith("api/"):
            err = AppError(404, "NOT_FOUND", "この窓口はありません。", how_to_fix="画面を再読み込みしてから、もう一度お試しください。")
            return JSONResponse(status_code=404, content=err.to_body())
        if path:
            target = (root / path).resolve()
            if target.is_relative_to(root) and target.is_file():
                cache = "public, max-age=31536000, immutable" if target.parent.name == "assets" else "public, max-age=3600"
                return FileResponse(target, headers={"Cache-Control": cache})
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
