"""アプリ共通のエラー形式（設計書 §15）。

すべてのエラーを次の形で返し、画面が「何が起きたか・原因・直し方」を表示できるようにする。
    {"error": {"code": ..., "message": ..., "cause": ..., "how_to_fix": ..., "node_id": ...}}
想定外の例外は内容（スタックトレース）を画面に出さず、サーバーログにだけ残す。
"""

import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

logger = logging.getLogger("flowcraft")


class AppError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        cause: str | None = None,
        how_to_fix: str | None = None,
        node_id: str | None = None,
    ):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.cause = cause
        self.how_to_fix = how_to_fix
        self.node_id = node_id

    def to_body(self) -> dict:
        return {
            "error": {
                "code": self.code,
                "message": self.message,
                "cause": self.cause,
                "how_to_fix": self.how_to_fix,
                "node_id": self.node_id,
            }
        }


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=exc.to_body())

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        err = AppError(
            422,
            "INVALID_REQUEST",
            "送信された内容の形式が正しくありません。",
            cause=f"{len(exc.errors())}件の項目に問題があります。",
            how_to_fix="画面を再読み込みしてからやり直してください。",
        )
        return JSONResponse(status_code=422, content=err.to_body())

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
        error_id = uuid.uuid4().hex[:8]
        logger.exception("unexpected error id=%s", error_id)
        err = AppError(
            500,
            "INTERNAL_ERROR",
            f"予期しないエラーが発生しました（エラー番号：{error_id}）。",
            how_to_fix="時間をおいて再度お試しください。解決しない場合はエラー番号をお知らせください。",
        )
        return JSONResponse(status_code=500, content=err.to_body())
