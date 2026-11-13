"""空白データの検出（Phase Q-2。docs/blank-data-design.md §3）。

読み込んだシート（見出しの行を決めた後）について、空白の種類ごとに件数と行（Excel上の行番号）を数える。
ここでは判定も変換もしない（扱いの決め方とルールの適用は Q-3・Q-4）。

| 種類 | 見分け方 |
|---|---|
| 表の途中の完全空白行 | 見出しの下〜最後のデータ行の間で、すべてのセルが空（空白文字だけ・空の文字列を返す数式も空とみなす） |
| 普通の空欄 | 値がない |
| 空白文字だけのセル | 値が空白文字だけ（見た目は空欄だが、今の読み込みでは「値がある」と数えている） |
| 空の文字列を返す数式 | 値は空欄と同じに見える。ファイルの XML から数式を調べて区別する（調べられないときは「判別できない」と示す） |
| 結合セルによる見かけの空欄 | 結合範囲の左上以外のセル。欠損として扱わない（結合範囲の値の続き） |
| 合計・メモの行の可能性 | 最後のデータ行の数値が、上の行の合計と一致する／先頭のセルに「合計・計・メモ」など |

判別できないものを「空白なし」と断定しない（formulas_checked＝False のときは、数式の空欄を判別できないと示す）。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from app.files.parse import RawSheet

MAX_ROWS_LISTED = 10
_TOTAL_WORDS = re.compile(r"(合計|総計|小計|累計|計$|集計|メモ|備考欄|注記|Total)", re.I)


@dataclass
class ColumnBlanks:
    name: str
    blank: int = 0  # 普通の空欄
    whitespace_only: int = 0  # 空白文字だけ
    formula_blank: int = 0  # 空の文字列を返す数式
    merged: int = 0  # 結合セルの続き（欠損として扱わない）
    rows: list[int] = field(default_factory=list)  # 空欄（結合の続きを除く）の Excel 上の行（最初の数件）

    @property
    def total(self) -> int:
        """欠損の候補（結合の続きは数えない）"""
        return self.blank + self.whitespace_only + self.formula_blank


@dataclass
class TotalRowCandidate:
    row: int  # Excel 上の行
    reasons: list[str]


@dataclass
class BlankReport:
    data_rows: int  # 見出しの下のデータの行数（途中の完全空白行を含む）
    middle_blank_rows: list[int]  # 表の途中の完全空白行（Excel 上の行）
    columns: list[ColumnBlanks]
    merged_ranges: list[str]  # データの範囲にかかる結合セル（例 "A9:B9"）
    formula_blank_cells: list[str]  # 空の文字列を返す数式のセル（例 "F7"）
    total_row_candidates: list[TotalRowCandidate]
    formulas_checked: bool  # 空の文字列を返す数式を判別できたか（CSV・読めなかったときは False）
    whitespace_cells: list[str] = field(default_factory=list)  # 空白文字だけのセル（例 "E5"。最初の数件）

    @property
    def has_any(self) -> bool:
        return bool(self.middle_blank_rows or any(c.total for c in self.columns) or self.total_row_candidates)


def _col_letter(i: int) -> str:
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def _cell(r: int, c: int) -> str:
    return f"{_col_letter(c)}{r + 1}"


def _is_whitespace(v: Any) -> bool:
    return isinstance(v, str) and v != "" and v.strip() == ""


def _is_empty(v: Any) -> bool:
    return v is None or (isinstance(v, str) and v == "")


_NUMERIC_TEXT = re.compile(r"^[+-]?\d[\d,]*(\.\d+)?$")


def _number(v: Any) -> Decimal | None:
    """数値（CSV は文字列で読むため、桁区切りのカンマを含む数字の文字列も数値とみなす）"""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float, Decimal)):
        return Decimal(str(v))
    if isinstance(v, str) and _NUMERIC_TEXT.match(v.strip()):
        return Decimal(v.strip().replace(",", ""))
    return None


def detect_blanks(sheet: RawSheet, header_row: int, columns: list[str]) -> BlankReport:
    """sheet：読み取った格子。header_row：見出しの行（1始まり）。columns：列名（見出しの左から順）"""
    grid = sheet.grid
    start = header_row  # データの最初の行（0始まり）
    width = len(columns)
    covered: set[tuple[int, int]] = set()  # 結合範囲の左上以外のセル
    merged_ranges: list[str] = []
    for r1, c1, r2, c2 in sheet.merged:
        if r2 < start:
            continue  # 見出しより上（表題など）
        merged_ranges.append(f"{_cell(r1, c1)}:{_cell(r2, c2)}")
        for r in range(max(r1, start), r2 + 1):
            for c in range(c1, c2 + 1):
                if (r, c) != (r1, c1):
                    covered.add((r, c))

    def value(r: int, c: int) -> Any:
        row = grid[r]
        return row[c] if c < len(row) else None

    # 1行ずつ、各セルを1回だけ分類する（10万行でも遅くならないよう、空欄のない行は簡単な判定だけで通す）
    formula_rows = {r for r, _ in sheet.formula_blanks}
    covered_rows = {r for r, _ in covered}
    data_idx = list(range(start, len(grid)))
    cols = [ColumnBlanks(name=n) for n in columns]
    whitespace_cells: list[str] = []
    middle: list[int] = []
    filled: list[int] = []
    pending: list[tuple[int, list[str | None]]] = []  # 空欄のある行（完全空白行かどうかは最後に決める）
    for r in data_idx:
        row = grid[r]
        if r not in formula_rows and r not in covered_rows and len(row) >= width:
            clean = True
            for v in row[:width]:
                if v is None or (v.__class__ is str and (v == "" or v.isspace())):
                    clean = False
                    break
            if clean:
                filled.append(r)
                continue
        kinds: list[str | None] = []
        special = r in formula_rows or r in covered_rows  # 結合・数式のある行だけ、セルごとに照合する
        n = len(row)
        for c in range(width):
            v = row[c] if c < n else None
            if special and (r, c) in covered:
                kinds.append("merged")
            elif special and (r, c) in sheet.formula_blanks:
                kinds.append("formula")
            elif v is not None and v.__class__ is not str:
                kinds.append(None)
            elif _is_whitespace(v):
                kinds.append("ws")
            elif _is_empty(v):
                kinds.append("blank")
            else:
                kinds.append(None)
        if all(k is not None for k in kinds):
            middle.append(r)
        else:
            filled.append(r)
            pending.append((r, kinds))
    # 末尾の空白行は読み取りで除いてあるが、念のため最後のデータ行より後は「途中」に数えない
    last = max(filled) if filled else start - 1
    middle = [r for r in middle if r < last]
    filled.sort()

    for r, kinds in pending:
        for c, kind in enumerate(kinds):
            col = cols[c]
            if kind == "merged":
                col.merged += 1
                continue
            if kind == "formula":
                col.formula_blank += 1
            elif kind == "ws":
                col.whitespace_only += 1
                if len(whitespace_cells) < MAX_ROWS_LISTED:
                    whitespace_cells.append(_cell(r, c))
            elif kind == "blank":
                col.blank += 1
            if kind and len(col.rows) < MAX_ROWS_LISTED:
                col.rows.append(r + 1)

    candidates: list[TotalRowCandidate] = []
    if len(filled) >= 3:
        r = filled[-1]
        above = filled[:-1]
        reasons: list[str] = []
        first = value(r, 0)
        if isinstance(first, str) and _TOTAL_WORDS.search(first.strip()):
            reasons.append(f"先頭のセルが「{first.strip()}」です")
        for c, name in enumerate(columns):
            n = _number(value(r, c))
            if n is None or n == 0:
                continue
            nums = [_number(value(x, c)) for x in above]
            present = [x for x in nums if x is not None]
            if len(present) >= 2 and sum(present, Decimal(0)) == n:
                reasons.append(f"「{name}」の値（{n:,f}）が、上の行の合計と一致します".replace(".0）", "）"))
        if reasons:
            candidates.append(TotalRowCandidate(row=r + 1, reasons=reasons))

    return BlankReport(
        data_rows=len(data_idx),
        middle_blank_rows=[r + 1 for r in middle],
        columns=cols,
        merged_ranges=merged_ranges,
        formula_blank_cells=sorted((_cell(r, c) for r, c in sheet.formula_blanks if r >= start), key=lambda x: (int(re.sub(r"\D", "", x)), x)),
        total_row_candidates=candidates,
        formulas_checked=sheet.formulas_checked,
        whitespace_cells=whitespace_cells,
    )
