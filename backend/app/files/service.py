"""アップロードされたファイルの受け入れと、画面に返す情報の組み立て。

流れ：サイズ確認 → 種類判定（中身で） → 読み取り → 行数の上限確認 → セッションに保管
元のファイル（バイト列）は解析後すぐ手放し、ディスクには書き込まない。
"""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone

from pydantic import BaseModel

from app.config import Settings
from app.files.detect import FileKind, decode_csv, detect_kind, file_error, safe_filename
from app.files.parse import RawSheet, read_csv, read_xlsx
from app.files.profile import ColumnType, FileWarning, Table, build_table, preview_rows, profile_columns, suggest_header_row
from app.sessions.store import Session


@dataclass
class UploadedFile:
    file_id: str
    filename: str
    kind: FileKind
    encoding: str | None
    size_bytes: int
    uploaded_at: datetime
    sheets: dict[str, RawSheet]
    # ファイルの中身から計算する識別（SHA-256）。品質の履歴に「どのデータを検証したか」を残す（中身そのものは残さない）
    sha256: str = ""

    @property
    def data_rows(self) -> int:
        """全シートのデータ行数（見出しを1行目とした場合）。上限の判定に使う。"""
        return sum(max(len(s.grid) - 1, 0) for s in self.sheets.values())

    def default_sheet(self) -> str:
        """最初に表示するシート：表示中で、データのある最初のシート。"""
        for s in self.sheets.values():
            if not s.hidden and s.grid:
                return s.name
        return next(iter(self.sheets))


# ---------------------------------------------------------------------------
# 画面に返す形（API の応答）
# ---------------------------------------------------------------------------


class WarningOut(BaseModel):
    code: str
    message: str


class ColumnOut(BaseModel):
    name: str
    inferred_type: ColumnType
    non_null_count: int
    null_count: int
    unique_count: int
    samples: list[str]
    note: str | None


class PreviewOut(BaseModel):
    columns: list[str]
    rows: list[list[str | None]]
    shown: int  # 表示している行数
    total: int  # 全行数（全件に基づく）


class SheetDetail(BaseModel):
    sheet: str
    header_row: int
    row_count: int
    column_count: int
    columns: list[ColumnOut]
    preview: PreviewOut
    warnings: list[WarningOut]


class SheetSummary(BaseModel):
    name: str
    hidden: bool
    is_empty: bool


class FileSummary(BaseModel):
    file_id: str
    filename: str
    kind: FileKind
    encoding: str | None
    size_bytes: int
    uploaded_at: datetime
    sheets: list[SheetSummary]


class UploadResult(FileSummary):
    detail: SheetDetail  # 最初に表示するシートの詳細


def summarize(f: UploadedFile) -> FileSummary:
    return FileSummary(
        file_id=f.file_id,
        filename=f.filename,
        kind=f.kind,
        encoding=f.encoding,
        size_bytes=f.size_bytes,
        uploaded_at=f.uploaded_at,
        sheets=[SheetSummary(name=s.name, hidden=s.hidden, is_empty=not s.grid) for s in f.sheets.values()],
    )


def sheet_detail(f: UploadedFile, sheet: str | None, header_row: int | None) -> SheetDetail:
    """header_row が None のときは、見出しの行を推定する（表題・空行を飛ばす）"""
    name = sheet or f.default_sheet()
    raw = f.sheets.get(name)
    if raw is None:
        raise file_error(
            "SHEET_NOT_FOUND",
            f"シート「{name}」が見つかりません。",
            how_to_fix="一覧からシートを選び直してください。",
            status=404,
        )
    guessed = header_row is None
    if header_row is None:
        header_row = suggest_header_row(raw.grid) if f.kind == "xlsx" else 1
    table: Table = build_table(raw, header_row, is_csv=f.kind == "csv")
    if guessed and header_row > 1:
        table.warnings.insert(
            0,
            FileWarning(
                "HEADER_ROW_GUESSED",
                f"見出しの行を{header_row}行目と推定しました（上の行は表題や空行のため）。違う場合は、見出しの行を変えてください。",
            ),
        )
    rows = preview_rows(table)
    return SheetDetail(
        sheet=name,
        header_row=header_row,
        row_count=len(table.rows),
        column_count=len(table.columns),
        columns=[ColumnOut(**vars(p)) for p in profile_columns(table)],
        preview=PreviewOut(columns=table.columns, rows=rows, shown=len(rows), total=len(table.rows)),
        warnings=[WarningOut(code=w.code, message=w.message) for w in table.warnings],
    )


# ---------------------------------------------------------------------------
# 受け入れ
# ---------------------------------------------------------------------------


def accept_upload(session: Session, data: bytes, original_name: str | None, settings: Settings) -> UploadedFile:
    filename = safe_filename(original_name)
    max_bytes = settings.max_file_size_mb * 1024 * 1024

    if len(session.files) >= settings.max_files:
        raise file_error(
            "TOO_MANY_FILES",
            f"読み込めるファイルは{settings.max_files}つまでです。",
            how_to_fix="使わないファイルを削除してから、もう一度読み込んでください。",
            status=409,
        )
    if len(data) > max_bytes:
        raise file_error(
            "FILE_TOO_LARGE",
            f"「{filename}」はサイズの上限（{settings.max_file_size_mb}MB）を超えています。",
            how_to_fix="不要な行・列・シートを削除して、ファイルを小さくしてください。",
            status=413,
        )

    kind = detect_kind(data, filename, settings.max_uncompressed_mb * 1024 * 1024)
    remaining = settings.max_total_rows - sum(f.data_rows for f in session.files.values())
    encoding: str | None = None
    # 読み取り中は「1ファイルの上限＝全体の上限」で打ち切り、合計の判定は読み取り後に行う
    if kind == "xlsx":
        sheets = read_xlsx(data, filename, settings.max_columns, settings.max_total_rows)
    else:
        text, encoding = decode_csv(data, filename)
        sheets = [read_csv(text, filename, settings.max_columns, settings.max_total_rows)]

    uploaded = UploadedFile(
        file_id="f_" + secrets.token_urlsafe(9),
        filename=filename,
        kind=kind,
        encoding=encoding,
        size_bytes=len(data),
        uploaded_at=datetime.now(timezone.utc),
        sheets={s.name: s for s in sheets},
        sha256=hashlib.sha256(data).hexdigest(),
    )
    if all(not s.grid for s in sheets):
        raise file_error("EMPTY_FILE", f"「{filename}」にはデータがありません。", how_to_fix="データが入っているファイルを選んでください。")
    if uploaded.data_rows > remaining:
        raise file_error(
            "TOTAL_ROWS_EXCEEDED",
            f"読み込んだファイルの合計行数が上限（{settings.max_total_rows:,}行）を超えます。",
            cause=f"このファイルは{uploaded.data_rows:,}行、読み込める残りは{max(remaining, 0):,}行です。",
            how_to_fix="使わないファイルを削除するか、行数を減らしたファイルを読み込んでください。",
            status=413,
        )
    session.files[uploaded.file_id] = uploaded
    return uploaded


def get_file(session: Session, file_id: str) -> UploadedFile:
    f = session.files.get(file_id)
    if not isinstance(f, UploadedFile):
        # 他人のセッションのファイルIDでも、存在しないIDでも、同じ応答にする（存在を推測させない）
        raise file_error(
            "FILE_NOT_FOUND",
            "ファイルが見つかりません。",
            how_to_fix="ファイルをもう一度読み込んでください。時間切れで削除された可能性があります。",
            status=404,
        )
    return f
