"""空白のルールの判定（Phase Q-3。docs/blank-data-design.md §5、確認事項：案A）。

読み込みのステップが残した空白の検出結果（BLANK_SUMMARY）と、作業手順の空白のルールから、
完了基準の結果と同じ形（CriterionResult）を作る。総合判定・正式出力の停止・結果の画面・Excel の確認結果は、
完了基準と同じ仕組みをそのまま使う（別の判定の仕組みを作らない）。

| 状況 | 結果 |
|---|---|
| 列の空欄：ルール「許可」 | 何も出さない（件数は読み込みの記録に残る） |
| 列の空欄：ルール「注意」 | 満たしていない（注意） |
| 列の空欄：ルール「止める」 | 満たしていない（重大）→ 正式な出力を止める |
| 列の空欄：ルールなし・任意の列 | 許可とみなす（何も出さない） |
| 列の空欄：ルールなし・必須の列 | 未検証（注意）：扱いが決まっていない。画面では確認すれば出力できる。無人実行では止める |
| 表の途中の空白行：扱いが未定義 | 未検証（注意） |
| 最後の行が合計・メモの行の可能性：扱いが未定義 | 満たしていない（注意） |
"""

from __future__ import annotations

from app.criteria.evaluate import CriterionResult
from app.engine.result import RunResult
from app.flow.schema import FlowDefinition, LoadNode

KIND = "blank_rule"


def _rows(rows: list[int]) -> str:
    shown = "、".join(str(r) for r in rows[:5])
    return shown + (" など" if len(rows) > 5 else "")


def blank_results(flow: FlowDefinition, result: RunResult) -> list[CriterionResult]:
    defs = {d.input_id: d for d in flow.input_definitions}
    runs = {n.node_id: n for n in result.nodes}
    out: list[CriterionResult] = []
    for node in flow.nodes:
        if not isinstance(node, LoadNode):
            continue
        run = runs.get(node.node_id)
        summary = next((i for i in run.issues if i.code == "BLANK_SUMMARY"), None) if run else None
        d = defs.get(node.parameters.input_id)
        if summary is None or d is None:
            continue
        det = summary.details
        label = d.label
        base_id = f"blank__{d.input_id}"

        for idx, col in enumerate(d.columns):
            info = det.get("columns", {}).get(col.name)
            if not info or not info["count"]:
                continue
            n, rows = info["count"], info["rows"]
            action = col.blank.action if col.blank else None
            if action == "allow" or (action is None and not col.required):
                continue
            name = f"「{label}」の「{col.name}」に空欄がない"
            evidence = {"空欄の件数": f"{n:,}", "Excelの行": _rows(rows)}
            if info.get("whitespace"):
                evidence["うち空白文字だけ"] = f"{info['whitespace']:,}"
            if info.get("formula"):
                evidence["うち空の文字列を返す数式"] = f"{info['formula']:,}"
            examples = [{"Excelの行": r} for r in rows[:5]]
            if action is None:
                out.append(
                    CriterionResult(
                        criterion_id=f"{base_id}__c{idx}",
                        name=name,
                        kind=KIND,
                        on_fail="caution",
                        status="unverified",
                        summary=f"必ずある列「{col.name}」に空欄が{n:,}件あります。この列の空欄の扱い（許可・注意・止める）が決まっていません。",
                        evidence=evidence,
                        examples=examples,
                        how_to_fix="作業手順の入力の設定で、この列の空欄の扱いを決めてください（決めた内容は作業手順に保存され、次回から自動で適用されます）。",
                    )
                )
            else:
                out.append(
                    CriterionResult(
                        criterion_id=f"{base_id}__c{idx}",
                        name=name,
                        kind=KIND,
                        on_fail=action,
                        status="failed",
                        summary=f"列「{col.name}」に空欄が{n:,}件あります（Excelの行：{_rows(rows)}）。",
                        evidence=evidence,
                        examples=examples,
                        how_to_fix="元のファイルの空欄を埋めてから、もう一度実行してください。空欄が業務上ありうる場合は、空欄の扱いを見直してください。",
                    )
                )

        mid = det.get("middle_blank_rows") or []
        if mid and d.blank_rules.blank_rows == "unset":
            out.append(
                CriterionResult(
                    criterion_id=f"{base_id}__rows",
                    name=f"「{label}」の表の途中に空白行がない",
                    kind=KIND,
                    on_fail="caution",
                    status="unverified",
                    summary=f"表の途中に空白行が{len(mid)}行あります（Excelの行：{_rows(mid)}）。扱い（除外・残す・止める）が決まっていません。",
                    evidence={"空欄の件数": f"{len(mid):,}", "Excelの行": _rows(mid)},
                    examples=[{"Excelの行": r} for r in mid[:5]],
                    how_to_fix="区切りの空白行なら「除外する」、意味のある行なら「残す」を、作業手順の入力の設定で選んでください。",
                )
            )

        last = det.get("last_row_candidate")
        if last and d.blank_rules.last_row == "unset":
            out.append(
                CriterionResult(
                    criterion_id=f"{base_id}__last",
                    name=f"「{label}」の最後の行が合計・メモの行でない",
                    kind=KIND,
                    on_fail="caution",
                    status="failed",
                    summary=f"最後の行（Excelの{last['row']}行目）は、合計・メモの行の可能性があります：{'／'.join(last['reasons'])}。このままでは二重に集計されるおそれがあります。",
                    evidence={"Excelの行": str(last["row"])},
                    examples=[{"Excelの行": last["row"]}],
                    how_to_fix="合計・メモの行なら「除外する」、データの行なら「データの行として扱う」を、作業手順の入力の設定で選んでください。",
                )
            )
    return out
