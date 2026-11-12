"""ファイル読込ノード（仕様6.1）。

割り当てられたファイル・シートを読み、入力定義（列名・型）に合わせて表を作る。
- 列名の対応付け（column_mapping）：新しいファイルで列名が変わった場合に使う
- 必須列がない → エラー（似た列名を候補として示す）
- 型に変換できない値がある → エラー（列ごとの件数と、Excel上の行番号・値の例を示す）
- 入力定義にない列 → 文字列として残す（使わなくても削除しない）
"""

from __future__ import annotations

import difflib
from dataclasses import dataclass, field

from app.engine.convert import convert_value, to_string
from app.engine.registry import NodeContext, NodeOutput, register
from app.engine.result import EngineIssue, NodeFailure
from app.engine.table import ColumnSpec, Table
from app.files.profile import build_table
from app.flow.schema import LoadNode

MAX_EXAMPLES = 5


@dataclass
class Binding:
    """入力の割当（実行データ）。フローJSONには保存しない（設計書 §5.2）。"""

    input_id: str
    file_id: str
    sheet: str | None = None
    header_row: int = 1
    # 実際のファイルの列名 → 入力定義の列名
    column_mapping: dict[str, str] = field(default_factory=dict)


def _fail(code: str, message: str, how_to_fix: str, cause: str | None = None, **details: object) -> NodeFailure:
    return NodeFailure(EngineIssue(code, "error", message, cause=cause, how_to_fix=how_to_fix, details=dict(details)))


@register("load")
def run_load(node: LoadNode, inputs: list[Table], ctx: NodeContext) -> NodeOutput:
    input_id = node.parameters.input_id
    definition = ctx.input_definitions[input_id]
    binding: Binding | None = ctx.bindings.get(input_id)
    if binding is None:
        raise _fail(
            "INPUT_NOT_ASSIGNED",
            f"入力「{definition.label}」にファイルが割り当てられていません。",
            how_to_fix="読み込んだファイルの中から、この入力に使うファイルを選んでください。",
        )
    file = ctx.files.get(binding.file_id)
    if file is None:
        raise _fail(
            "FILE_NOT_FOUND",
            f"入力「{definition.label}」に割り当てたファイルが見つかりません。",
            how_to_fix="ファイルをもう一度読み込んでください。時間切れで削除された可能性があります。",
        )
    sheet_name = binding.sheet or file.default_sheet()
    raw = file.sheets.get(sheet_name)
    if raw is None:
        raise _fail("SHEET_NOT_FOUND", f"シート「{sheet_name}」が見つかりません。", how_to_fix="シートを選び直してください。")

    src = build_table(raw, binding.header_row, is_csv=file.kind == "csv")
    issues = [
        EngineIssue(w.code, "warning" if w.code in ("DUPLICATE_HEADER", "SHORT_ROWS", "BLANK_HEADER") else "info", w.message)
        for w in src.warnings
        if w.code != "HEADER_ONLY"
    ]

    # 列名の対応付け
    names = list(src.columns)
    for actual, defined in binding.column_mapping.items():
        if actual not in names:
            raise _fail("MAPPING_SOURCE_MISSING", f"対応付けた列「{actual}」がファイルにありません。", how_to_fix="列の対応付けを見直してください。")
        if defined in names and defined != actual:
            raise _fail(
                "MAPPING_CONFLICT",
                f"列「{actual}」を「{defined}」に対応付けようとしましたが、「{defined}」という列がすでにあります。",
                how_to_fix="列の対応付けを見直してください。",
            )
        names[names.index(actual)] = defined
    raw_data = {names[i]: [r[i] for r in src.rows] for i in range(len(names))}
    n_rows = len(src.rows)

    # 必須列の確認
    missing = [c.name for c in definition.columns if c.required and c.name not in raw_data]
    if missing:
        hints = {m: difflib.get_close_matches(m, [x for x in names if x not in {c.name for c in definition.columns}], n=2, cutoff=0.4) for m in missing}
        hint_text = "、".join(f"「{m}」→ 候補：{'・'.join(h)}" for m, h in hints.items() if h)
        raise _fail(
            "MISSING_COLUMNS",
            f"必要な列がありません：{'、'.join(missing)}",
            cause=f"候補：{hint_text}" if hint_text else "ファイルの列名が変わった可能性があります。",
            how_to_fix="列名が変わっている場合は、列の対応付けで新しい列名を指定してください。",
            missing=missing,
            candidates=hints,
        )

    columns: list[str] = []
    specs: dict[str, ColumnSpec] = {}
    data: dict[str, list[object]] = {}
    failures: dict[str, dict[str, object]] = {}
    defined = {c.name: c for c in definition.columns}

    for name in names:
        values = raw_data[name]
        if name in defined:
            col = defined[name]
            converted: list[object] = []
            bad = 0
            examples: list[dict[str, object]] = []
            for i, v in enumerate(values):
                out, ok = convert_value(v, col.type, scale=col.scale, date_format=col.date_format)
                if not ok:
                    bad += 1
                    if len(examples) < MAX_EXAMPLES:
                        # 利用者がExcelで探せるよう、シート上の行番号で示す
                        examples.append({"row": binding.header_row + 1 + i, "value": to_string(v)})
                converted.append(out)
            if bad:
                failures[name] = {"type": col.type, "count": bad, "examples": examples}
            columns.append(name)
            specs[name] = ColumnSpec(col.type, col.scale)
            data[name] = converted
        else:
            columns.append(name)
            specs[name] = ColumnSpec("string")
            data[name] = [to_string(v) for v in values]

    if failures:
        type_label = {"integer": "整数", "decimal": "小数", "date": "日付", "boolean": "真偽値", "string": "文字列"}
        parts = []
        for col_name, f in failures.items():
            ex = "、".join(f"{e['row']}行目「{e['value']}」" for e in f["examples"])  # type: ignore[union-attr]
            parts.append(f"「{col_name}」（{type_label[str(f['type'])]}）{f['count']}件：{ex}")
        raise _fail(
            "TYPE_CONVERSION_FAILED",
            "決められた型に変換できない値があります。",
            cause=" ／ ".join(parts),
            how_to_fix="元のファイルの値を修正するか、型変換ノードで扱い方を指定してください。変換できない値を黙って空欄にはしません。",
            failures=failures,
        )

    # 任意列（required=false）がファイルにない場合は、空欄の列として追加する（その旨を記録）
    for col in definition.columns:
        if col.name not in data:
            columns.append(col.name)
            specs[col.name] = ColumnSpec(col.type, col.scale)
            data[col.name] = [None] * n_rows
            issues.append(EngineIssue("OPTIONAL_COLUMN_ADDED", "info", f"任意の列「{col.name}」がファイルにないため、空欄の列として追加しました。"))

    issues.append(
        EngineIssue("LOADED", "info", f"「{file.filename}」（{sheet_name}）から{n_rows:,}行を読み込みました。", details={"file": file.filename, "sheet": sheet_name})
    )
    return NodeOutput(table=Table(columns=columns, specs=specs, data=data), issues=issues)
