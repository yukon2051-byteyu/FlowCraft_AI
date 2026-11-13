"""再実行時の入力の変化の検出（Phase 3-1）。

保存した作業手順の入力定義（前回の列構成）と、今回割り当てたファイルの列を比べ、処理を始める前に変化を知らせる。

見つけるもの：
- 必須の列がない（実行できない）／任意の列がない（空欄として読み込む）
- 列名が変わった可能性：今回のファイルの、使っていない列の中から候補を選び、理由を添える（P-1）。
  名前の似ている度合い・データの形式が合うか・前回と同じ並びか、の3点で順位をつける。**自動では対応付けない**
- 列が増えた（読み込まない）
- 列の順番が変わった（結果は変わらないため、お知らせだけ。P-2）
- データの形式が変わった（決めた形式に変換できない値がある。実行できない）
- 必須の列の空欄（件数と行を示すだけ。扱いのルールは Phase Q。P-3）

利用者が承認した列の対応付け（今回のファイルの列名 → 前回の列名）を受け取り、対応付けたうえで比べる（P-4：今回の実行の割当にだけ記録する）。
変換には、実行時の読み込み（engine/nodes/load.py）と同じ関数を使う（「確認ではOKだったのに、実行すると失敗する」ことを防ぐ）。
"""

from __future__ import annotations

import difflib
import unicodedata
from dataclasses import dataclass, field

from app.engine.convert import convert_value, is_missing, to_string
from app.files.profile import Table
from app.flow.schema import ColumnSchema, InputDefinition

MAX_EXAMPLES = 5
MAX_CANDIDATES = 3
# 候補として示す最低の点数（0〜1）。名前がまったく似ていなくても、形式と並びが合えば候補に残る
MIN_SCORE = 0.35
# 形式が「合う」とみなす割合（空欄を除いた値のうち、決めた形式に変換できる割合）
TYPE_FIT = 0.95

TYPE_LABEL = {"string": "文字", "integer": "整数", "decimal": "小数", "date": "日付", "boolean": "はい／いいえ"}


@dataclass
class RenameCandidate:
    column: str  # 今回のファイルの列名
    score: float
    reasons: list[str]


@dataclass
class MissingColumn:
    name: str  # 前回の列名（入力定義の列名）
    type: str
    required: bool
    candidates: list[RenameCandidate]


@dataclass
class TypeProblem:
    name: str
    type: str
    failed: int
    examples: list[dict[str, object]]  # {"row": Excel上の行番号, "value": 値}


@dataclass
class BlankValues:
    name: str
    count: int
    rows: list[int]  # Excel上の行番号（最初の数件）


@dataclass
class InputComparison:
    input_id: str
    label: str
    missing: list[MissingColumn] = field(default_factory=list)
    added: list[str] = field(default_factory=list)
    order_changed: bool = False
    expected_order: list[str] = field(default_factory=list)
    actual_order: list[str] = field(default_factory=list)
    type_problems: list[TypeProblem] = field(default_factory=list)
    blank_required: list[BlankValues] = field(default_factory=list)
    mapping_errors: list[str] = field(default_factory=list)
    mapping_applied: dict[str, str] = field(default_factory=dict)

    @property
    def can_run(self) -> bool:
        """必須の列がそろい、形式が合い、対応付けに誤りがなければ実行できる（空欄・列の追加・順番の変化は止めない）"""
        return not self.mapping_errors and not self.type_problems and not any(m.required for m in self.missing)

    @property
    def has_changes(self) -> bool:
        return bool(self.missing or self.added or self.order_changed or self.type_problems or self.blank_required or self.mapping_errors)


def _norm(name: str) -> str:
    """比べるための正規化：全角・半角をそろえ、空白を除き、英字を小文字にする"""
    return "".join(unicodedata.normalize("NFKC", name).split()).lower()


def _name_similarity(a: str, b: str) -> float:
    na, nb = _norm(a), _norm(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    ratio = difflib.SequenceMatcher(None, na, nb).ratio()
    # 一方がもう一方を含む（「売上金額」と「金額」など）は、似ているとみなす
    if na in nb or nb in na:
        ratio = max(ratio, 0.75)
    return ratio


def _type_fit(col: ColumnSchema, values: list[object]) -> float | None:
    """空欄を除いた値のうち、決めた形式に変換できる割合。値がない列は None"""
    present = [v for v in values if not is_missing(v)]
    if not present:
        return None
    ok = sum(1 for v in present if convert_value(v, col.type, scale=col.scale, date_format=col.date_format)[1])
    return ok / len(present)


def _empty_row(row: list[object]) -> bool:
    return all(is_missing(v) for v in row)


def _candidates(
    target: ColumnSchema,
    definition: InputDefinition,
    names: list[str],
    data: dict[str, list[object]],
    unused: list[str],
) -> list[RenameCandidate]:
    defined = [c.name for c in definition.columns]
    pos = defined.index(target.name)
    prev_name = defined[pos - 1] if pos > 0 else None
    next_name = defined[pos + 1] if pos + 1 < len(defined) else None
    out: list[RenameCandidate] = []
    for cand in unused:
        reasons: list[str] = []
        sim = _name_similarity(target.name, cand)
        if sim >= 0.5:
            reasons.append(f"列名が似ています（「{target.name}」と「{cand}」）")

        fit = _type_fit(target, data[cand])
        type_score = 0.0
        if target.type != "string":
            # 文字の列はどんな値でも読めるため、形式が合うことは手がかりにならない
            if fit is None or fit < TYPE_FIT:
                continue  # 決めた形式で読めない列は、対応付けても実行できないため候補にしない
            type_score = 1.0
            reasons.append(f"値がすべて{TYPE_LABEL[target.type]}として読めます")

        # 前回と同じ並び：前回の前後の列が、今回もこの列の前後にある
        i = names.index(cand)
        same_place = (prev_name is not None and i > 0 and names[i - 1] == prev_name) or (
            next_name is not None and i + 1 < len(names) and names[i + 1] == next_name
        )
        if same_place:
            beside = prev_name if prev_name is not None and i > 0 and names[i - 1] == prev_name else next_name
            where = "次" if beside == prev_name else "前"
            reasons.append(f"前回と同じ並びです（「{beside}」の{where}）")

        place = 1.0 if same_place else 0.0
        if target.type == "string":
            # 文字の列は形式が手がかりにならないため、名前と並びだけで点数をつける
            score = round(0.75 * sim + 0.25 * place, 3)
        else:
            score = round(0.6 * sim + 0.25 * type_score + 0.15 * place, 3)
        if score >= MIN_SCORE and reasons:
            out.append(RenameCandidate(cand, score, reasons))
    out.sort(key=lambda c: (-c.score, names.index(c.column)))
    return out[:MAX_CANDIDATES]


def compare_input(definition: InputDefinition, table: Table, header_row: int, mapping: dict[str, str] | None = None) -> InputComparison:
    """前回の列構成（入力定義）と今回のファイル（見出しの行で読んだ表）を比べる。"""
    result = InputComparison(input_id=definition.input_id, label=definition.label)
    defined = {c.name: c for c in definition.columns}
    names = list(table.columns)

    # 利用者が承認した対応付けを当てる（実行時の読み込みと同じ規則で、誤りは知らせる）
    for actual, target in (mapping or {}).items():
        if actual not in names:
            result.mapping_errors.append(f"対応付けた列「{actual}」が今回のファイルにありません。")
        elif target not in defined:
            result.mapping_errors.append(f"「{target}」は作業手順で使う列ではありません。")
        elif target in result.mapping_applied.values():
            result.mapping_errors.append(f"「{target}」に、2つ以上の列が対応付けられています。")
        elif target in names and target != actual:
            result.mapping_errors.append(f"「{actual}」を「{target}」に対応付けようとしましたが、今回のファイルに「{target}」という列がすでにあります。")
        else:
            result.mapping_applied[actual] = target
            names[names.index(actual)] = target

    rows = [r for r in table.rows]
    data = {names[i]: [r[i] for r in rows] for i in range(len(names))}
    non_empty = [i for i, r in enumerate(rows) if not _empty_row(r)]

    # 列が増えた（作業手順で使わない列は読み込まない）
    unused = [n for n in names if n not in defined]
    result.added = list(unused)

    # 列がない（必須・任意）と、列名の変更の候補
    for col in definition.columns:
        if col.name not in data:
            result.missing.append(MissingColumn(col.name, col.type, col.required, _candidates(col, definition, names, data, unused)))

    # 列の順番（作業手順で使う列だけで比べる）
    result.expected_order = [c.name for c in definition.columns if c.name in data]
    result.actual_order = [n for n in names if n in defined]
    result.order_changed = result.expected_order != result.actual_order

    # データの形式と、必須の列の空欄（表の途中の空の行は、空欄として数えない）
    for col in definition.columns:
        if col.name not in data:
            continue
        values = data[col.name]
        failed = 0
        examples: list[dict[str, object]] = []
        blanks: list[int] = []
        for i in non_empty:
            v = values[i]
            if is_missing(v):
                blanks.append(header_row + 1 + i)
                continue
            if not convert_value(v, col.type, scale=col.scale, date_format=col.date_format)[1]:
                failed += 1
                if len(examples) < MAX_EXAMPLES:
                    examples.append({"row": header_row + 1 + i, "value": to_string(v)})
        if failed:
            result.type_problems.append(TypeProblem(col.name, col.type, failed, examples))
        if col.required and blanks:
            result.blank_required.append(BlankValues(col.name, len(blanks), blanks[:MAX_EXAMPLES]))
    return result
