"""Excel・CSVを「行と列の格子（グリッド）」として読み取る。

ここではデータを一切変換しない。
- Excel：セルの値をそのまま（数値・日付・文字列・真偽値）保持する
- CSV  ：すべて文字列のまま保持する（"00123" を 123 にしない）。空欄だけを None（欠損）として扱う
見出し行の決定・列名の整理・型の推定は profile.py で行う。
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from typing import Any

from app.files.detect import file_error

# 末尾の空行がこの数だけ続いたら、それ以降は書式だけの空行とみなして読むのをやめる
_TRAILING_EMPTY_STOP = 5000


@dataclass
class RawSheet:
    name: str
    hidden: bool
    grid: list[list[Any]]  # 表の末尾の空行は取り除き済み（Excelは各行末尾の空セルも除去済み）


def _trim_row(row: list[Any]) -> list[Any]:
    end = len(row)
    while end > 0 and _is_blank(row[end - 1]):
        end -= 1
    return row[:end]


def _is_blank(v: Any) -> bool:
    return v is None or (isinstance(v, str) and v == "")


def _finish(name: str, hidden: bool, rows: list[list[Any]], filename: str, max_columns: int, max_rows: int) -> RawSheet:
    while rows and not _trim_row(rows[-1]):
        rows.pop()
    widest = max((len(_trim_row(r)) for r in rows), default=0)
    if widest > max_columns:
        raise file_error(
            "TOO_MANY_COLUMNS",
            f"「{filename}」の「{name}」は列が多すぎます（{widest}列）。",
            how_to_fix=f"使わない列を削除し、{max_columns}列以内にしてから読み込んでください。",
            status=413,
        )
    if len(rows) - 1 > max_rows:
        raise _too_many_rows(filename, max_rows)
    return RawSheet(name=name, hidden=hidden, grid=rows)


def _too_many_rows(filename: str, max_rows: int):
    return file_error(
        "TOO_MANY_ROWS",
        f"「{filename}」の行数が上限（{max_rows:,}行）を超えています。",
        how_to_fix="期間や対象を絞ったファイルに分けてから読み込んでください。",
        status=413,
    )


def read_xlsx(data: bytes, filename: str, max_columns: int, max_rows: int) -> list[RawSheet]:
    import openpyxl  # 読み込みに時間がかかるため、使うときだけ読み込む

    try:
        # data_only=True：数式ではなく、Excelが最後に保存した計算結果を読む
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception:
        raise file_error(
            "CORRUPTED_XLSX",
            f"「{filename}」を読み込めませんでした。ファイルが壊れている可能性があります。",
            how_to_fix="Excelで開けるか確認し、「Excelブック（*.xlsx）」として保存し直してください。",
        ) from None

    sheets: list[RawSheet] = []
    try:
        for ws in wb.worksheets:
            rows: list[list[Any]] = []
            empty_run = 0
            for raw in ws.iter_rows(values_only=True):
                row = _trim_row(list(raw))
                rows.append(row)
                empty_run = empty_run + 1 if not row else 0
                if empty_run >= _TRAILING_EMPTY_STOP:
                    break  # 書式だけが設定された大量の空行
                if len(rows) - empty_run - 1 > max_rows:
                    raise _too_many_rows(filename, max_rows)
            sheets.append(_finish(ws.title, ws.sheet_state != "visible", rows, filename, max_columns, max_rows))
    finally:
        wb.close()
    return sheets


def read_csv(text: str, filename: str, max_columns: int, max_rows: int) -> RawSheet:
    rows: list[list[Any]] = []
    try:
        for record in csv.reader(io.StringIO(text, newline="")):
            # CSVは区切りの数（列数）の確認に使うため、行末の空欄を削らずに残す
            rows.append([None if v == "" else v for v in record])
            if len(rows) - 1 > max_rows + _TRAILING_EMPTY_STOP:
                raise _too_many_rows(filename, max_rows)
    except csv.Error as e:
        raise file_error(
            "CSV_PARSE_ERROR",
            f"「{filename}」をCSVとして読み取れませんでした。",
            cause=f"{e}",
            how_to_fix="引用符（\"）の閉じ忘れなどがないか確認するか、Excelで開いてCSV形式で保存し直してください。",
        ) from None
    return _finish("CSV", False, rows, filename, max_columns, max_rows)
