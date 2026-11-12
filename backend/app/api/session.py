"""セッションAPI。画面は最初に POST /api/session で番号を受け取り、以降のAPIに X-Session-Id ヘッダーで付ける。"""

from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request, Response
from pydantic import BaseModel

from app.sessions.store import Session, SessionStore

router = APIRouter(tags=["session"])


def get_store(request: Request) -> SessionStore:
    return request.app.state.session_store


def current_session(
    x_session_id: Annotated[str | None, Header()] = None,
    store: SessionStore = Depends(get_store),
) -> Session:
    """各APIで「このリクエストはどのセッションのものか」を確認する共通部品。"""
    return store.get(x_session_id)


class SessionCreated(BaseModel):
    session_id: str
    expires_in_seconds: int


class SessionInfo(BaseModel):
    expires_in_seconds: int
    file_count: int


@router.post("/session", response_model=SessionCreated, status_code=201)
def create_session(store: SessionStore = Depends(get_store)) -> SessionCreated:
    s = store.create()
    return SessionCreated(session_id=s.session_id, expires_in_seconds=store.remaining_seconds(s))


@router.get("/session", response_model=SessionInfo)
def session_info(
    session: Session = Depends(current_session), store: SessionStore = Depends(get_store)
) -> SessionInfo:
    return SessionInfo(expires_in_seconds=store.remaining_seconds(session), file_count=len(session.files))


@router.delete("/session", status_code=204)
def end_session(session: Session = Depends(current_session), store: SessionStore = Depends(get_store)) -> Response:
    """作業を終了し、読み込んだデータをすぐに削除する。"""
    store.delete(session.session_id)
    return Response(status_code=204)
