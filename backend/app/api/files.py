"""ファイルAPI：アップロード・一覧・シート詳細（プレビュー）・削除。"""

from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile

from app.api.session import current_session
from app.config import Settings, get_settings
from app.files.service import (
    FileSummary,
    SheetDetail,
    UploadResult,
    accept_upload,
    get_file,
    sheet_detail,
    summarize,
)
from app.sessions.store import Session

router = APIRouter(tags=["files"])


@router.post("/files", response_model=UploadResult, status_code=201)
def upload_file(
    file: Annotated[UploadFile, File()],
    session: Session = Depends(current_session),
    settings: Settings = Depends(get_settings),
) -> UploadResult:
    try:
        # 上限+1バイトだけ読む（巨大なファイルを最後まで読まない）
        data = file.file.read(settings.max_file_size_mb * 1024 * 1024 + 1)
    finally:
        file.file.close()  # 受信時の一時領域をすぐに解放する
    uploaded = accept_upload(session, data, file.filename, settings)
    del data
    detail = sheet_detail(uploaded, None, 1)
    return UploadResult(**summarize(uploaded).model_dump(), detail=detail)


@router.get("/files", response_model=list[FileSummary])
def list_files(session: Session = Depends(current_session)) -> list[FileSummary]:
    return [summarize(f) for f in session.files.values()]


@router.get("/files/{file_id}", response_model=SheetDetail)
def file_detail(
    file_id: str,
    sheet: str | None = None,
    header_row: Annotated[int, Query(ge=1, le=100)] = 1,
    session: Session = Depends(current_session),
) -> SheetDetail:
    return sheet_detail(get_file(session, file_id), sheet, header_row)


@router.delete("/files/{file_id}", status_code=204)
def delete_file(file_id: str, session: Session = Depends(current_session)) -> Response:
    get_file(session, file_id)
    del session.files[file_id]
    return Response(status_code=204)
