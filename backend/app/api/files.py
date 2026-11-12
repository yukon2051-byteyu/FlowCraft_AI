"""ファイルAPI：アップロード・一覧・シート詳細（プレビュー）・削除。"""

from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile
from pydantic import BaseModel, Field

from app.api.session import current_session
from app.config import Settings, get_settings
from app.engine.convert import convert_value, to_string
from app.files.detect import file_error
from app.files.profile import build_table
from app.files.service import (
    FileSummary,
    SheetDetail,
    UploadResult,
    accept_upload,
    get_file,
    sheet_detail,
    summarize,
)
from app.flow.schema import ColumnType
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


# ---------------------------------------------------------------------------
# 形式の確認：利用者が選んだデータの形式で、全件を変換できるかを確かめる（タスク1-2）
# 実行時の読み込み（engine/nodes/load.py）と同じ変換関数を使うため、
# 「確認ではOKだったのに、実行すると失敗する」ことは起きない。
# ---------------------------------------------------------------------------

MAX_EXAMPLES = 5


class TypeCheckColumn(BaseModel):
    name: str
    type: ColumnType
    scale: Annotated[int, Field(ge=0, le=10)] | None = None
    date_format: str | None = None


class TypeCheckRequest(BaseModel):
    sheet: str | None = None
    header_row: Annotated[int, Field(ge=1, le=100)] = 1
    columns: Annotated[list[TypeCheckColumn], Field(min_length=1, max_length=500)]


class TypeCheckExample(BaseModel):
    row: int  # Excel上の行番号（利用者がファイルで探せるように）
    value: str | None


class TypeCheckResult(BaseModel):
    name: str
    type: ColumnType
    found: bool
    converted: int
    failed: int
    blank: int
    examples: list[TypeCheckExample]


@router.post("/files/{file_id}/type-check", response_model=list[TypeCheckResult])
def type_check(file_id: str, req: TypeCheckRequest, session: Session = Depends(current_session)) -> list[TypeCheckResult]:
    f = get_file(session, file_id)
    sheet = req.sheet or f.default_sheet()
    raw = f.sheets.get(sheet)
    if raw is None:
        raise file_error("SHEET_NOT_FOUND", f"シート「{sheet}」が見つかりません。", how_to_fix="シートを選び直してください。", status=404)
    table = build_table(raw, req.header_row, is_csv=f.kind == "csv")
    index = {c: i for i, c in enumerate(table.columns)}
    out: list[TypeCheckResult] = []
    for col in req.columns:
        if col.name not in index:
            out.append(TypeCheckResult(name=col.name, type=col.type, found=False, converted=0, failed=0, blank=0, examples=[]))
            continue
        i = index[col.name]
        converted = failed = blank = 0
        examples: list[TypeCheckExample] = []
        for r, row in enumerate(table.rows):
            value, ok = convert_value(row[i], col.type, scale=col.scale, date_format=col.date_format)
            if not ok:
                failed += 1
                if len(examples) < MAX_EXAMPLES:
                    examples.append(TypeCheckExample(row=req.header_row + 1 + r, value=to_string(row[i])))
            elif value is None:
                blank += 1
            else:
                converted += 1
        out.append(TypeCheckResult(name=col.name, type=col.type, found=True, converted=converted, failed=failed, blank=blank, examples=examples))
    return out
