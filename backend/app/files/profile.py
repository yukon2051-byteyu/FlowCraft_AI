"""見出し行の決定・列名の整理・型の推定・プレビュー作成（設計書 §8・§12.1）。

型の推定は「提案」であり、データ自体は変換しない。実際の変換は、利用者が確定した
フローの読込ノード・型変換ノードで行い、変換できなかった件数を必ず報告する。
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, time
from decimal import Decimal
from typing import Any, Literal

from openpyxl.utils import get_column_letter

from app.files.detect import file_error
from app.files.parse import RawSheet, _is_blank, _trim_row

ColumnType = Literal["string", "integer", "decimal", "date", "boolean"]

PREVIEW_ROWS = 50
SAMPLE_VALUES = 3


@dataclass
class FileWarning:
    code: str
    message: str


@dataclass
class ColumnProfile:
    name: str
    inferred_type: ColumnType
    non_null_count: int
    null_count: int
    unique_count: int
    samples: list[str]
    note: str | None = None


@dataclass
class Table:
    """見出し行を決めた後の表。rows は列数にそろえ済み（足りないセルは None）。"""

    columns: list[str]
    rows: list[list[Any]]
    warnings: list[FileWarning] = field(default_factory=list)


# ---------------------------------------------------------------------------
# 見出し行と列名
# ---------------------------------------------------------------------------


def build_table(sheet: RawSheet, header_row: int, *, is_csv: bool) -> Table:
    grid = sheet.grid
    if not grid:
        return Table(columns=[], rows=[], warnings=[FileWarning("EMPTY_SHEET", f"シート「{sheet.name}」にはデータがありません。")])
    if header_row > len(grid):
        raise file_error(
            "HEADER_ROW_OUT_OF_RANGE",
            f"見出し行（{header_row}行目）がデータの範囲外です（全{len(grid)}行）。",
            how_to_fix="見出し（列名）が書かれている行の番号を指定してください。",
        )

    header = _trim_row(grid[header_row - 1])
    data = grid[header_row:]
    # 列数は「値が入っている一番右の列」まで（末尾の空欄だけの列は数えない）
    width = max([len(header)] + [len(_trim_row(r)) for r in data])
    warnings: list[FileWarning] = []

    columns, name_warnings = _column_names(header, width)
    warnings += name_warnings

    rows: list[list[Any]] = []
    short_rows = 0
    empty_rows = 0
    for r in data:
        if not _trim_row(r):
            empty_rows += 1
        elif is_csv and len(r) < len(header):
            short_rows += 1  # CSVで区切り（コンマ）の数が見出しより少ない行
        rows.append((r + [None] * width)[:width])

    if short_rows:
        warnings.append(
            FileWarning("SHORT_ROWS", f"区切りの数が見出しより少ない行が{short_rows:,}行あります。足りない部分は空欄として扱います。")
        )
    if empty_rows:
        warnings.append(FileWarning("EMPTY_ROWS", f"表の途中に空の行が{empty_rows:,}行あります（削除せずに残しています）。"))
    if not rows:
        warnings.append(FileWarning("HEADER_ONLY", "見出し行だけで、データの行がありません。"))
    return Table(columns=columns, rows=rows, warnings=warnings)


def _header_text(v: Any) -> str | None:
    if _is_blank(v):
        return None
    if isinstance(v, datetime):
        return v.strftime("%Y/%m/%d") if v.time() == time(0) else v.strftime("%Y/%m/%d %H:%M")
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def _column_names(header: list[Any], width: int) -> tuple[list[str], list[FileWarning]]:
    names: list[str] = []
    generated: list[str] = []
    trimmed: list[str] = []
    for i in range(width):
        raw = _header_text(header[i]) if i < len(header) else None
        if raw is None or raw.strip() == "":
            name = f"列{get_column_letter(i + 1)}"
            generated.append(name)
        else:
            name = " ".join(raw.split("\n")).strip()  # セル内改行は空白に、前後の空白は除く
            if name != raw:
                trimmed.append(raw)
        names.append(name)

    warnings: list[FileWarning] = []
    if generated:
        warnings.append(
            FileWarning("BLANK_HEADER", f"見出しが空欄の列に仮の名前を付けました：{'、'.join(generated[:10])}")
        )
    if trimmed:
        shown = "、".join(f"「{t}」" for t in trimmed[:5])
        warnings.append(FileWarning("HEADER_TRIMMED", f"列名の前後の空白・改行を取り除きました：{shown}"))

    # 重複した列名には _2, _3 … を付けて区別する
    seen: Counter[str] = Counter()
    renamed: list[str] = []
    result: list[str] = []
    for n in names:
        seen[n] += 1
        if seen[n] == 1:
            result.append(n)
            continue
        candidate = f"{n}_{seen[n]}"
        while candidate in names or candidate in result:
            seen[n] += 1
            candidate = f"{n}_{seen[n]}"
        result.append(candidate)
        renamed.append(f"「{n}」→「{candidate}」")
    if renamed:
        warnings.append(FileWarning("DUPLICATE_HEADER", f"同じ名前の列があるため名前を変えました：{'、'.join(renamed[:10])}"))
    return result, warnings


# ---------------------------------------------------------------------------
# 型の推定
# ---------------------------------------------------------------------------

_INT_RE = re.compile(r"^[+-]?[0-9]+$")
_INT_COMMA_RE = re.compile(r"^[+-]?[0-9]{1,3}(,[0-9]{3})+$")
_DEC_RE = re.compile(r"^[+-]?([0-9]+|[0-9]{1,3}(,[0-9]{3})+)?\.[0-9]+$")
_DATE_RE = re.compile(r"^([0-9]{4})[/-]([0-9]{1,2})[/-]([0-9]{1,2})( [0-9]{1,2}:[0-9]{2}(:[0-9]{2})?)?$")

_TYPE_LABEL = {"string": "文字", "integer": "整数", "decimal": "小数", "date": "日付", "boolean": "はい／いいえ"}


def _classify(v: Any) -> str:
    """1つの値を分類する：boolean / integer / decimal / date / code（先頭0の数字）/ string"""
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, int):
        return "integer"
    if isinstance(v, float):
        return "integer" if v.is_integer() else "decimal"
    if isinstance(v, Decimal):
        return "decimal"
    if isinstance(v, (datetime, date)):
        return "date"
    if not isinstance(v, str):
        return "string"
    s = v.strip()
    if _INT_RE.match(s):
        digits = s.lstrip("+-")
        return "code" if len(digits) > 1 and digits.startswith("0") else "integer"
    if _INT_COMMA_RE.match(s):
        return "integer"
    if _DEC_RE.match(s):
        return "decimal"
    m = _DATE_RE.match(s)
    if m:
        try:
            date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            return "date"
        except ValueError:
            return "string"
    if s.lower() in ("true", "false"):
        return "boolean"
    return "string"


def infer_type(values: list[Any]) -> tuple[ColumnType, str | None]:
    """列の値（欠損を除く）から型を推定し、(型, 補足説明) を返す。"""
    if not values:
        return "string", "すべて空欄です。"
    counts = Counter(_classify(v) for v in values)
    total = len(values)

    if "code" in counts and set(counts) <= {"code", "integer"}:
        return "string", "先頭が0の数字（コードと思われる値）を含むため、文字列として扱います。"
    if len(counts) == 1:
        only = next(iter(counts))
        return ("string" if only == "code" else only), None  # type: ignore[return-value]
    if set(counts) <= {"integer", "decimal"}:
        return "decimal", None

    # 大部分（90%以上）が同じ型なら、その型「らしい」と補足する
    main, main_count = max(((k, c) for k, c in counts.items() if k not in ("string", "code")), key=lambda kc: kc[1], default=("string", 0))
    if main != "string" and main_count / total >= 0.9:
        others = total - main_count
        examples = [_display(v) for v in values if _classify(v) not in (main, "integer" if main == "decimal" else main)][:3]
        return "string", (
            f"{_TYPE_LABEL[main]}と思われますが、一致しない値が{others:,}件あります"
            f"（例：{'、'.join(str(e) for e in examples)}）。"
        )
    return "string", None


def profile_columns(table: Table) -> list[ColumnProfile]:
    profiles: list[ColumnProfile] = []
    for i, name in enumerate(table.columns):
        values = [r[i] for r in table.rows if not _is_blank(r[i])]
        inferred, note = infer_type(values)
        uniq = len({(type(v).__name__, v) for v in values})
        samples: list[str] = []
        for v in values:
            d = _display(v)
            if d is not None and d not in samples:
                samples.append(d)
            if len(samples) >= SAMPLE_VALUES:
                break
        profiles.append(
            ColumnProfile(
                name=name,
                inferred_type=inferred,
                non_null_count=len(values),
                null_count=len(table.rows) - len(values),
                unique_count=uniq,
                samples=samples,
                note=note,
            )
        )
    return profiles


# ---------------------------------------------------------------------------
# 表示用の文字列化（プレビュー）
# ---------------------------------------------------------------------------


def _display(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else repr(v)
    if isinstance(v, Decimal):
        return format(v, "f")
    if isinstance(v, datetime):
        return v.strftime("%Y/%m/%d") if v.time() == time(0) else v.strftime("%Y/%m/%d %H:%M:%S")
    if isinstance(v, date):
        return v.strftime("%Y/%m/%d")
    if isinstance(v, time):
        return v.strftime("%H:%M:%S")
    return str(v)


def preview_rows(table: Table, limit: int = PREVIEW_ROWS) -> list[list[str | None]]:
    return [[_display(v) for v in r] for r in table.rows[:limit]]
