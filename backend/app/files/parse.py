"""Excel・CSVを「行と列の格子（グリッド）」として読み取る。

ここではデータを一切変換しない。
- Excel：セルの値をそのまま（数値・日付・文字列・真偽値）保持する
- CSV  ：すべて文字列のまま保持する（"00123" を 123 にしない）。空欄だけを None（欠損）として扱う
見出し行の決定・列名の整理・型の推定は profile.py で行う。
"""

from __future__ import annotations

import csv
import io
import re
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from app.files.detect import file_error

# 末尾の空行がこの数だけ続いたら、それ以降は書式だけの空行とみなして読むのをやめる
_TRAILING_EMPTY_STOP = 5000


@dataclass
class RawSheet:
    name: str
    hidden: bool
    grid: list[list[Any]]  # 表の末尾の空行は取り除き済み（Excelは各行末尾の空セルも除去済み）
    # 結合セルの範囲（0始まりの 行・列：開始行, 開始列, 終了行, 終了列）。Excel（calamine）のときだけ
    merged: list[tuple[int, int, int, int]] = field(default_factory=list)
    # 空の文字列を返す数式のセル（0始まりの 行, 列）。値としては普通の空欄と同じに見えるため、区別のために持つ
    formula_blanks: set[tuple[int, int]] = field(default_factory=set)
    # 数式の空欄を調べられたか（CSV・読めなかったときは False＝判別できない）
    formulas_checked: bool = False


def _trim_row(row: list[Any]) -> list[Any]:
    end = len(row)
    while end > 0 and _is_blank(row[end - 1]):
        end -= 1
    return row[:end]


def _is_blank(v: Any) -> bool:
    return v is None or (isinstance(v, str) and v == "")


def _finish(name: str, hidden: bool, rows: list[list[Any]], filename: str, max_columns: int, max_rows: int, **extra: Any) -> RawSheet:
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
    return RawSheet(name=name, hidden=hidden, grid=rows, **extra)


def _too_many_rows(filename: str, max_rows: int):
    return file_error(
        "TOO_MANY_ROWS",
        f"「{filename}」の行数が上限（{max_rows:,}行）を超えています。",
        how_to_fix="期間や対象を絞ったファイルに分けてから読み込んでください。",
        status=413,
    )


def read_xlsx(data: bytes, filename: str, max_columns: int, max_rows: int) -> list[RawSheet]:
    """Excelを読む。通常は高速な python-calamine を使う。

    ただし calamine はエラー値のセル（#N/A など）を空欄として返してしまう。
    そのまま使うと、エラー値が黙って空欄扱いになり集計から外れるため、
    エラー値のセルを含むファイルだけは、エラー値を文字として残す openpyxl で読む。
    """
    if _has_error_cells(data):
        return _read_xlsx_openpyxl(data, filename, max_columns, max_rows)
    return _read_xlsx_calamine(data, filename, max_columns, max_rows)


def _corrupted(filename: str):
    return file_error(
        "CORRUPTED_XLSX",
        f"「{filename}」を読み込めませんでした。ファイルが壊れている可能性があります。",
        how_to_fix="Excelで開けるか確認し、「Excelブック（*.xlsx）」として保存し直してください。",
    )


_ERROR_CELL = re.compile(rb'<c\b[^>]*\bt="e"')


def _has_error_cells(data: bytes) -> bool:
    """ワークシートのXMLに、エラー値のセル（t="e"）があるか調べる。"""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            for name in zf.namelist():
                if name.startswith("xl/worksheets/") and name.endswith(".xml"):
                    xml = zf.read(name)
                    # まず印（t="e"）の有無を素早く調べ、あるときだけ正確に判定する
                    if b't="e"' in xml and _ERROR_CELL.search(xml):
                        return True
    except zipfile.BadZipFile:
        return False  # 壊れたファイルは、読み取りの段階でエラーとして報告する
    return False


def _normalize_calamine(v: Any) -> Any:
    """calamine の値を openpyxl と同じ形にそろえる（値は変えない）。

    空欄 '' → None ／ 整数の float（2.0）→ int ／ 時刻のない日付（date）→ datetime
    """
    if v == "" and isinstance(v, str):
        return None
    if isinstance(v, float) and v.is_integer() and abs(v) < 2**63:
        return int(v)
    if isinstance(v, date) and not isinstance(v, datetime):
        return datetime(v.year, v.month, v.day)
    return v


# --- 空の文字列を返す数式のセル（Phase Q）：値を持たない数式（<f>…</f> だけ、または空の <v>）を XML から探す ---
_SHEET_TAG = re.compile(rb'<(?:\w+:)?sheet\b[^>]*?\bname="([^"]*)"[^>]*?\br:id="([^"]*)"')
_REL_TAG = re.compile(rb'<(?:\w+:)?Relationship\b[^>]*?\bId="([^"]*)"[^>]*?\bTarget="([^"]*)"')
_REL_TAG2 = re.compile(rb'<(?:\w+:)?Relationship\b[^>]*?\bTarget="([^"]*)"[^>]*?\bId="([^"]*)"')
_FORMULA_BLANK = re.compile(
    rb'<(?:\w+:)?c\b[^>]*?\br="([A-Z]+)(\d+)"[^>]*>\s*<(?:\w+:)?f\b[^>]*?(?:/>|>[^<]*</(?:\w+:)?f>)\s*(?:<(?:\w+:)?v\s*/>|<(?:\w+:)?v>\s*</(?:\w+:)?v>)?\s*</(?:\w+:)?c>',
    re.S,
)


def _col_index(letters: bytes) -> int:
    n = 0
    for ch in letters:
        n = n * 26 + (ch - 64)
    return n - 1


def _xml_unescape(b: bytes) -> str:
    return b.decode("utf-8").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&apos;", "'")


def formula_blank_cells(data: bytes) -> dict[str, set[tuple[int, int]]] | None:
    """シート名 → 空の文字列を返す数式のセル（0始まり）。調べられなければ None（判別できない）"""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            names = set(zf.namelist())
            wb = zf.read("xl/workbook.xml")
            rels = zf.read("xl/_rels/workbook.xml.rels")
            targets = {m.group(1): m.group(2) for m in _REL_TAG.finditer(rels)}
            targets.update({m.group(2): m.group(1) for m in _REL_TAG2.finditer(rels)})
            out: dict[str, set[tuple[int, int]]] = {}
            for m in _SHEET_TAG.finditer(wb):
                target = targets.get(m.group(2))
                if target is None:
                    continue
                path = target.decode().lstrip("/")
                path = path if path.startswith("xl/") else "xl/" + path
                if path not in names:
                    continue
                xml = zf.read(path)
                cells: set[tuple[int, int]] = set()
                if b"<f" in xml or b":f" in xml:
                    for c in _FORMULA_BLANK.finditer(xml):
                        cells.add((int(c.group(2)) - 1, _col_index(c.group(1))))
                out[_xml_unescape(m.group(1))] = cells
            return out
    except (KeyError, zipfile.BadZipFile, UnicodeDecodeError):
        return None


def _read_xlsx_calamine(data: bytes, filename: str, max_columns: int, max_rows: int) -> list[RawSheet]:
    import python_calamine as pc

    try:
        wb = pc.CalamineWorkbook.from_filelike(io.BytesIO(data))
        metas = [m for m in wb.sheets_metadata if m.typ == pc.SheetTypeEnum.WorkSheet]
    except Exception:
        raise _corrupted(filename) from None

    formulas = formula_blank_cells(data)
    sheets: list[RawSheet] = []
    try:
        for meta in metas:
            try:
                # skip_empty_area=False：A1を起点に、上の空行と左の空列も含めて返す
                # （iter_rows は左の空列を詰めて返すため、見出し位置がずれる。使わない）
                raw_rows = wb.get_sheet_by_name(meta.name).to_python(skip_empty_area=False)
            except Exception:
                raise _corrupted(filename) from None
            rows: list[list[Any]] = []
            empty_run = 0
            for raw in raw_rows:
                row = _trim_row([_normalize_calamine(v) for v in raw])
                rows.append(row)
                empty_run = empty_run + 1 if not row else 0
                if empty_run >= _TRAILING_EMPTY_STOP:
                    break
                if len(rows) - empty_run - 1 > max_rows:
                    raise _too_many_rows(filename, max_rows)
            sheet = wb.get_sheet_by_name(meta.name)
            merged = [(a[0], a[1], b[0], b[1]) for a, b in (getattr(sheet, "merged_cell_ranges", None) or [])]
            blanks = formulas.get(meta.name) if formulas is not None else None
            sheets.append(
                _finish(
                    meta.name,
                    meta.visible != pc.SheetVisibleEnum.Visible,
                    rows,
                    filename,
                    max_columns,
                    max_rows,
                    merged=merged,
                    formula_blanks=blanks or set(),
                    formulas_checked=blanks is not None,
                )
            )
    finally:
        wb.close()
    return sheets


def _read_xlsx_openpyxl(data: bytes, filename: str, max_columns: int, max_rows: int) -> list[RawSheet]:
    import openpyxl  # 読み込みに時間がかかるため、使うときだけ読み込む

    try:
        # data_only=True：数式ではなく、Excelが最後に保存した計算結果を読む
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception:
        raise _corrupted(filename) from None

    formulas = formula_blank_cells(data)
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
            blanks = formulas.get(ws.title) if formulas is not None else None
            sheets.append(
                _finish(ws.title, ws.sheet_state != "visible", rows, filename, max_columns, max_rows, formula_blanks=blanks or set(), formulas_checked=blanks is not None)
            )
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
    # CSV には数式・結合セルがない（数式の空欄は「判別済み：なし」）
    return _finish("CSV", False, rows, filename, max_columns, max_rows, formulas_checked=True)
