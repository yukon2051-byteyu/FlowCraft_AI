"""フローJSONの読込と構造検証（設計書 §4.2・§9.2）。

役割分担：
- parse_flow          ：JSON → FlowDefinition。形が不正なら FlowSchemaError（日本語メッセージ付き）
- validate_structure  ：ノード同士の参照関係を検証し、問題の一覧（Issue）を返す
- compute_dependencies：参照関係から dependencies を自動計算する（人が手で書かない）
- check_move          ：ノードの並べ替えが参照関係を壊さないか判定する（画面の上下移動用）
- execution_blockers  ：実行できない理由（構造エラー・未確定ノード）を返す
- criteria_issues     ：完了基準・実行時に指定する値の参照関係を検証する（1.1。validate_structure から呼ぶ）
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

from pydantic import ValidationError

from app.flow.schema import (
    CRITERIA_NEEDING_COLUMN,
    CRITERIA_ON_INPUT,
    NODE_TYPES,
    SUPPORTED_SCHEMA_VERSIONS,
    Dependency,
    ExpectedValueCriterion,
    FlowDefinition,
    JoinNode,
    LoadNode,
    Node,
    OutputNode,
    ParamRef,
    PeriodCriterion,
    TotalMatchCriterion,
    ValueRangeCriterion,
)

Severity = Literal["error", "warning"]


@dataclass(frozen=True)
class Issue:
    """検証で見つかった問題。画面ではノードを赤（error）・アンバー（warning）で強調する。"""

    code: str
    severity: Severity
    message: str
    node_id: str | None = None


class FlowSchemaError(Exception):
    """フローJSONの形が不正。errors は (場所, 日本語メッセージ) の一覧。"""

    def __init__(self, errors: list[tuple[str, str]]):
        self.errors = errors
        summary = "; ".join(f"{loc}: {msg}" for loc, msg in errors[:5])
        super().__init__(f"作業手順のファイルの形式が正しくありません（{len(errors)}件）: {summary}")


# ---------------------------------------------------------------------------
# 読込
# ---------------------------------------------------------------------------

_PYDANTIC_MESSAGES = {
    "missing": "必須の項目がありません",
    "extra_forbidden": "定義されていない項目です",
    "literal_error": "使用できない値です",
    "string_pattern_mismatch": "使用できない文字が含まれています（英数字と _ のみ）",
    "string_too_short": "空にできません",
    "string_too_long": "長すぎます",
    "too_short": "要素が足りません",
    "too_long": "要素が多すぎます",
    "int_parsing": "整数で指定してください",
    "uuid_parsing": "IDの形式が正しくありません",
    "datetime_from_date_parsing": "日時の形式が正しくありません",
    "datetime_parsing": "日時の形式が正しくありません",
    "decimal_parsing": "数値で指定してください",
    "greater_than_equal": "値が小さすぎます",
    "less_than_equal": "値が大きすぎます",
    "string_type": "文字列で指定してください",
    "list_type": "リスト（配列）で指定してください",
    "model_type": "オブジェクトで指定してください",
    "dict_type": "オブジェクトで指定してください",
    "bool_type": "true または false で指定してください",
}


def _location(loc: tuple[Any, ...]) -> str:
    """('nodes', 2, 'join', 'parameters', 'how') → 'nodes[2].parameters.how'"""
    out = ""
    for part in loc:
        if isinstance(part, int):
            out += f"[{part}]"
        elif part in NODE_TYPES or part in ("condition", "group", "column", "constant", "operation"):
            continue  # 判別用の内部ラベルは利用者に見せない
        else:
            out += ("." if out else "") + str(part)
    return out or "(全体)"


def _translate(err: dict[str, Any]) -> tuple[str, str]:
    loc = _location(tuple(err.get("loc", ())))
    etype = err.get("type", "")
    if etype == "union_tag_invalid":
        tag = (err.get("ctx") or {}).get("tag")
        return loc, f"対応していない処理の種類です: {tag}"
    if etype == "union_tag_not_found":
        return loc, "処理の種類（node_type / kind）が指定されていません"
    if etype == "value_error":
        # model_validator で投げた日本語メッセージをそのまま使う
        msg = str(err.get("msg", "")).removeprefix("Value error, ")
        return loc, msg
    if etype == "recursion_loop" or etype == "recursion_error":
        return loc, "入れ子が深すぎます"
    return loc, _PYDANTIC_MESSAGES.get(etype, f"値が正しくありません（{etype}）")


def parse_flow(data: str | bytes | dict[str, Any]) -> FlowDefinition:
    """フローJSON（文字列または辞書）を検証して FlowDefinition にする。"""
    if isinstance(data, (str, bytes)):
        try:
            data = json.loads(data)
        except (json.JSONDecodeError, UnicodeDecodeError, RecursionError) as e:
            raise FlowSchemaError([("(全体)", f"JSONとして読み込めません: {e}")]) from None
    if not isinstance(data, dict):
        raise FlowSchemaError([("(全体)", "作業手順のファイルの形式が正しくありません（最上位が { } で囲まれていません）")])

    # バージョンは最初に確認し、未対応なら分かりやすいエラーにする
    version = data.get("schema_version")
    if version not in SUPPORTED_SCHEMA_VERSIONS:
        raise FlowSchemaError(
            [
                (
                    "schema_version",
                    f"未対応のスキーマバージョンです: {version!r}（対応：{', '.join(SUPPORTED_SCHEMA_VERSIONS)}）",
                )
            ]
        )
    try:
        return FlowDefinition.model_validate(data)
    except ValidationError as e:
        raise FlowSchemaError([_translate(err) for err in e.errors(include_url=False)]) from None
    except RecursionError:
        raise FlowSchemaError([("(全体)", "入れ子が深すぎます")]) from None


# ---------------------------------------------------------------------------
# 構造検証
# ---------------------------------------------------------------------------


def _ordering_issues(nodes: list[Node]) -> list[Issue]:
    """R1（参照は上にあるものだけ）・R2（出力名は一意）を検証する。"""
    issues: list[Issue] = []
    producer: dict[str, str] = {}  # 参照名 → それを作ったノードID
    all_outputs = {n.output_reference for n in nodes if n.output_reference}

    for n in nodes:
        for ref in n.input_references:
            if ref in producer:
                continue
            if ref in all_outputs:
                later = next(m.node_id for m in nodes if m.output_reference == ref)
                issues.append(
                    Issue(
                        "REFERENCE_NOT_YET_DEFINED",
                        "error",
                        f"「{n.node_name}」は、より下にあるステップ（{later}）の結果「{ref}」を使っています。"
                        "使うデータを作るステップより下に置いてください。",
                        n.node_id,
                    )
                )
            else:
                issues.append(
                    Issue(
                        "UNKNOWN_REFERENCE",
                        "error",
                        f"「{n.node_name}」が参照しているデータ「{ref}」はどのステップでも作られていません。",
                        n.node_id,
                    )
                )
        if n.output_reference:
            if n.output_reference in producer:
                issues.append(
                    Issue(
                        "DUPLICATE_OUTPUT_REFERENCE",
                        "error",
                        f"データ名「{n.output_reference}」が複数のステップで作られています"
                        f"（{producer[n.output_reference]} と {n.node_id}）。",
                        n.node_id,
                    )
                )
            else:
                producer[n.output_reference] = n.node_id
    return issues


def validate_structure(flow: FlowDefinition) -> list[Issue]:
    """ノード同士・入力定義との関係を検証する。データの中身は見ない。"""
    issues: list[Issue] = []
    nodes = flow.nodes

    # 入力定義のID重複
    input_ids = [d.input_id for d in flow.input_definitions]
    for dup in sorted({i for i in input_ids if input_ids.count(i) > 1}):
        issues.append(Issue("DUPLICATE_INPUT_ID", "error", f"入力定義のID「{dup}」が重複しています。"))

    # ノードID重複
    node_ids = [n.node_id for n in nodes]
    for dup in sorted({i for i in node_ids if node_ids.count(i) > 1}):
        issues.append(Issue("DUPLICATE_NODE_ID", "error", f"ステップID「{dup}」が重複しています。", dup))

    # 読込ノードが存在しない入力を指していないか
    known_inputs = set(input_ids)
    for n in nodes:
        if isinstance(n, LoadNode) and n.parameters.input_id not in known_inputs:
            issues.append(
                Issue(
                    "UNKNOWN_INPUT_ID",
                    "error",
                    f"「{n.node_name}」が読み込む入力「{n.parameters.input_id}」は入力定義にありません。",
                    n.node_id,
                )
            )

    issues += _ordering_issues(nodes)

    # 出力ノード：1つまで・最後に置く
    outputs = [i for i, n in enumerate(nodes) if isinstance(n, OutputNode)]
    if len(outputs) > 1:
        for i in outputs[1:]:
            issues.append(
                Issue("MULTIPLE_OUTPUT_NODES", "error", "「Excelに出力する」ステップは1つだけ置けます。", nodes[i].node_id)
            )
    if outputs and outputs[0] != len(nodes) - 1:
        issues.append(
            Issue("OUTPUT_NOT_LAST", "error", "「Excelに出力する」ステップは、作業手順の最後に置いてください。", nodes[outputs[0]].node_id)
        )
    if nodes and not outputs:
        issues.append(Issue("NO_OUTPUT_NODE", "warning", "「Excelに出力する」ステップがないため、結果をExcelに出力できません。"))

    # R4：誰にも使われないデータ（出力ノードがある場合のみ判定）
    if outputs:
        used = {ref for n in nodes for ref in n.input_references}
        for n in nodes:
            if n.output_reference and n.output_reference not in used:
                issues.append(
                    Issue(
                        "UNUSED_REFERENCE",
                        "warning",
                        f"「{n.node_name}」の結果はどこにも使われず、出力もされません。",
                        n.node_id,
                    )
                )

    issues += criteria_issues(flow)

    # 保存されている dependencies が参照関係と一致しているか（手で書き換えられていないか）
    if flow.dependencies and not any(i.severity == "error" for i in issues):
        if _normalize(flow.dependencies) != _normalize(compute_dependencies(flow)):
            issues.append(
                Issue(
                    "DEPENDENCIES_MISMATCH",
                    "error",
                    "ステップどうしのつながりの記録が、実際の内容と一致しません。ファイルが手作業で編集された可能性があります。",
                )
            )
    return issues


_MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _is_date(v: str) -> bool:
    if not _DATE.match(v):
        return False
    try:
        date.fromisoformat(v)
    except ValueError:
        return False
    return True


def _is_number(v: str) -> bool:
    try:
        return Decimal(v).is_finite()
    except (InvalidOperation, ValueError):
        return False


def criteria_issues(flow: FlowDefinition) -> list[Issue]:
    """完了基準と、実行時に指定する値の参照関係を検証する（データの中身は見ない）。

    - 基準の参照名・実行時に指定する値の参照名が重ならない
    - 確かめる対象（入力・ステップの結果）が作業手順の中にある
    - 種類ごとの決まり（入力が対象の基準・結合の結果が対象の基準・列が必要な基準）
    - 値の形（対象の月は「2026-10」、日付は「2026-10-01」、数値）と、実行時に指定する値の種類
    """
    issues: list[Issue] = []
    params = {p.param_id: p for p in flow.run_parameters}
    ids = [p.param_id for p in flow.run_parameters]
    for dup in sorted({i for i in ids if ids.count(i) > 1}):
        issues.append(Issue("DUPLICATE_PARAM_ID", "error", f"実行時に指定する値のID「{dup}」が重複しています。"))

    items = flow.completion_criteria.items
    cids = [c.criterion_id for c in items]
    for dup in sorted({i for i in cids if cids.count(i) > 1}):
        issues.append(Issue("DUPLICATE_CRITERION_ID", "error", f"完了基準のID「{dup}」が重複しています。"))

    inputs = {d.input_id for d in flow.input_definitions}
    outputs = {n.output_reference for n in flow.nodes if n.output_reference}
    joins = {n.output_reference for n in flow.nodes if isinstance(n, JoinNode) and n.output_reference}
    known = inputs | outputs

    def err(code: str, c: Any, text: str) -> None:
        issues.append(Issue(code, "error", f"完了基準「{c.name}」：{text}"))

    def check_value(c: Any, v: Any, what: str, allowed: tuple[str, ...], literal_ok: Any) -> None:
        if v is None:
            return
        if isinstance(v, ParamRef):
            p = params.get(v.param)
            if p is None:
                err("UNKNOWN_RUN_PARAMETER", c, f"{what}に使う「実行時に指定する値」（{v.param}）が定義されていません。")
            elif p.type not in allowed:
                err("RUN_PARAMETER_TYPE", c, f"{what}に、種類が「{p.type}」の値（{p.label}）は使えません。")
        elif not literal_ok(v):
            err("INVALID_CRITERION_VALUE", c, f"{what}の値「{v}」の形が正しくありません。")

    for c in items:
        ref = c.target.ref
        if ref not in known:
            err("UNKNOWN_CRITERION_TARGET", c, f"確かめる対象（{ref}）が作業手順の中にありません。")
        elif c.kind in CRITERIA_ON_INPUT and ref not in inputs:
            err("CRITERION_TARGET_NOT_INPUT", c, "この種類の基準は、読み込むファイル（入力）を対象にしてください。")
        elif c.kind == "all_matched" and ref not in joins:
            err("CRITERION_TARGET_NOT_JOIN", c, "この種類の基準は、「別の表から情報を付け加える」ステップの結果を対象にしてください。")

        needs_column = c.kind in CRITERIA_NEEDING_COLUMN or (isinstance(c, ExpectedValueCriterion) and c.params.measure == "sum")
        if needs_column and not c.target.column:
            err("CRITERION_COLUMN_REQUIRED", c, "確かめる列を指定してください。")

        if isinstance(c, TotalMatchCriterion) and c.params.compare_ref not in known:
            err("UNKNOWN_CRITERION_TARGET", c, f"比べる相手（{c.params.compare_ref}）が作業手順の中にありません。")
        if isinstance(c, PeriodCriterion):
            check_value(c, c.params.month, "対象の月", ("month",), lambda v: bool(_MONTH.match(v)))
            check_value(c, c.params.start, "開始日", ("date",), _is_date)
            check_value(c, c.params.end, "終了日", ("date",), _is_date)
        if isinstance(c, ValueRangeCriterion):
            # 範囲は数値または日付（列の形式は実行時に確かめる）
            for what, v in (("最小", c.params.min), ("最大", c.params.max)):
                check_value(c, v, what, ("integer", "decimal", "date"), lambda x: _is_number(x) or _is_date(x))
        if isinstance(c, ExpectedValueCriterion):
            check_value(c, c.params.value, "確認用の値", ("integer", "decimal"), _is_number)

    cc = flow.completion_criteria
    for ch in cc.changelog:
        if ch.version > cc.version:
            issues.append(Issue("INVALID_CRITERIA_CHANGELOG", "error", f"完了基準の変更の記録（版{ch.version}）が、今の版（{cc.version}）より新しくなっています。"))
    return issues


def _normalize(deps: list[Dependency]) -> dict[str, list[str]]:
    return {d.node_id: sorted(d.depends_on) for d in deps}


def compute_dependencies(flow: FlowDefinition) -> list[Dependency]:
    """各ノードがどのノードの結果に依存しているかを、参照名から計算する。"""
    producer = {n.output_reference: n.node_id for n in flow.nodes if n.output_reference}
    return [
        Dependency(node_id=n.node_id, depends_on=[producer[r] for r in n.input_references if r in producer])
        for n in flow.nodes
    ]


# ---------------------------------------------------------------------------
# 並べ替え・実行可否
# ---------------------------------------------------------------------------


def check_move(flow: FlowDefinition, node_id: str, new_index: int) -> tuple[bool, str | None]:
    """ノードを new_index へ移動してよいか（R5）。不可なら理由を返す。"""
    nodes = list(flow.nodes)
    idx = next((i for i, n in enumerate(nodes) if n.node_id == node_id), None)
    if idx is None:
        return False, f"ステップ「{node_id}」が見つかりません。"
    if not 0 <= new_index < len(nodes):
        return False, "移動先の位置が範囲外です。"
    node = nodes.pop(idx)
    nodes.insert(new_index, node)

    before = {(i.code, i.node_id) for i in _ordering_issues(list(flow.nodes))}
    for issue in _ordering_issues(nodes):
        if (issue.code, issue.node_id) not in before:
            return False, issue.message
    if isinstance(node, OutputNode) and new_index != len(nodes) - 1:
        return False, "「Excelに出力する」ステップは、作業手順の最後から動かせません。"
    if any(isinstance(n, OutputNode) for n in nodes[:-1]) and not isinstance(node, OutputNode):
        return False, "「Excelに出力する」ステップより下には移動できません。"
    return True, None


def execution_blockers(flow: FlowDefinition) -> list[Issue]:
    """実行できない理由の一覧。空なら実行してよい（データの互換性は別途検証する）。"""
    blockers = [i for i in validate_structure(flow) if i.severity == "error"]
    if not flow.nodes:
        blockers.append(Issue("EMPTY_FLOW", "error", "処理ステップがありません。"))
    for n in flow.nodes:
        if n.confirmation_status != "confirmed":
            label = {"unset": "未設定", "ai_proposed": "AI提案のまま", "pending": "確認待ち"}[n.confirmation_status]
            blockers.append(
                Issue("NODE_NOT_CONFIRMED", "error", f"「{n.node_name}」が{label}です。内容を確認して確定してください。", n.node_id)
            )
        elif n.open_questions:
            blockers.append(
                Issue("OPEN_QUESTIONS", "error", f"「{n.node_name}」にAIからの未回答の確認があります。", n.node_id)
            )
    return blockers
