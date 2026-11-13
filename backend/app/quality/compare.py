"""前回比較（品質MVP QM-2・共通基盤。docs/quality-mvp-design.md §4）。

保存先（ブラウザ・SQLite・PostgreSQL）には依存しない。呼び出し側が、同じ作業手順の過去の記録を渡す。

比べる相手の選び方（D-2）：
- 業務の数値（件数・合計）：同じ作業手順の、**直前の対象月**の、**正式な出力を行った**記録（最新）。なければ比べない（前々月には飛ばさない）
- 品質異常の件数：同じ作業手順の、直前の対象月の、**検証まで終わった**記録（正式な出力が止まった回も含む）
- 同じ対象月の記録（テストで何度も実行したもの）は前回にしない。処理が途中で止まった記録・別の作業手順の記録も使わない
- デモの記録と通常の記録は混ぜない（D-5）

比較できない条件（D-2）：処理の手順が変わっただけでは止めない。**その数値の定義**（指標の設定と、その表を作るまでの
上流のステップの設定）が変わったときだけ「前回から集計条件が変更されたため、比較できません」とする。
"""

from __future__ import annotations

import hashlib
import json
import re
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel

from app.flow.schema import FlowDefinition, LoadNode
from app.quality.models import RECORD_VERSION, RunRecord, RunSource

Category = Literal["business", "quality"]

_MONTH = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")

# ルールの設定のうち、異常の件数に関わらない項目（名前・メモ・識別・重さなど）
_RULE_COSMETIC = ("criterion_id", "name", "note", "rule_id", "rule_version", "copied_from", "origin", "confirmation_status", "on_fail")


# ---------------------------------------------------------------------------
# 対象期間
# ---------------------------------------------------------------------------


def period_of(flow: FlowDefinition, run_values: dict[str, str]) -> str | None:
    """対象期間：実行時に指定する値のうち、最初の「月」の値（例 "2026-10"）"""
    for p in flow.run_parameters:
        if p.type == "month" and run_values.get(p.param_id):
            value = run_values[p.param_id].strip()
            return value if _MONTH.match(value) else None
    return None


def previous_period(period: str) -> str:
    y, m = int(period[:4]), int(period[5:7])
    return f"{y - 1}-12" if m == 1 else f"{y}-{m - 1:02d}"


def period_label(period: str) -> str:
    return f"{int(period[:4])}年{int(period[5:7])}月"


# ---------------------------------------------------------------------------
# 定義の指紋
# ---------------------------------------------------------------------------


def _hash(obj: Any) -> str:
    text = json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)
    return hashlib.sha256(text.encode()).hexdigest()[:32]


def _input_definition(flow: FlowDefinition, input_id: str) -> dict[str, Any] | None:
    d = next((x for x in flow.input_definitions if x.input_id == input_id), None)
    if d is None:
        return None
    data = d.model_dump(mode="json", by_alias=True)
    data.pop("label", None)  # 表示名は数値に関わらない
    return data


def ref_fingerprint(flow: FlowDefinition, ref: str) -> str:
    """参照名（表）を作るまでの上流のステップだけの指紋。下流や関係のないステップの変更では変わらない"""
    producer = {n.output_reference: n for n in flow.nodes if n.output_reference}
    seen: set[str] = set()
    stack = [ref]
    inputs: set[str] = set()
    while stack:
        r = stack.pop()
        node = producer.get(r)
        if node is None:
            inputs.add(r)  # 入力（読み込む前のファイル）を直接指している
            continue
        if node.node_id in seen:
            continue
        seen.add(node.node_id)
        stack.extend(node.input_references)
        if isinstance(node, LoadNode):
            inputs.add(node.parameters.input_id)
    steps = [
        {"type": n.node_type, "params": n.parameters.model_dump(mode="json", by_alias=True), "inputs": n.input_references, "output": n.output_reference}
        for n in flow.nodes
        if n.node_id in seen
    ]
    return _hash({"ref": ref, "steps": steps, "inputs": {i: _input_definition(flow, i) for i in sorted(inputs)}})


def input_fingerprint(flow: FlowDefinition, input_id: str) -> str:
    return _hash({"input": _input_definition(flow, input_id)})


def rule_fingerprint(flow: FlowDefinition, criterion: Any) -> str:
    """ルールの異常件数の定義：判定の設定（重さ・名前を除く）と、対象の表を作るまでの上流"""
    setting = {k: v for k, v in criterion.model_dump(mode="json", by_alias=True).items() if k not in _RULE_COSMETIC}
    return _hash({"rule": setting, "target": ref_fingerprint(flow, criterion.target.ref)})


def change_metric_fingerprint(flow: FlowDefinition, criterion: Any) -> str:
    p = criterion.params
    return _hash({"measure": p.measure, "column": criterion.target.column if p.measure == "sum" else None, "target": ref_fingerprint(flow, criterion.target.ref)})


def change_metric_id(criterion: Any) -> str:
    return f"rule:{criterion.rule_id}"


# ---------------------------------------------------------------------------
# 比べる相手
# ---------------------------------------------------------------------------


def parse_history(items: list[Any]) -> list[RunRecord]:
    """渡された過去の記録を読む。形の合わないもの・版の違うものは使わない（比較の相手にしない）"""
    out: list[RunRecord] = []
    for item in items:
        try:
            rec = item if isinstance(item, RunRecord) else RunRecord.model_validate(item)
        except ValueError:
            continue
        if rec.record_version == RECORD_VERSION:
            out.append(rec)
    return out


def select_baseline(
    flow_id: str, period: str | None, history: list[RunRecord], category: Category, *, source: RunSource = "manual", exclude_run_id: str | None = None
) -> tuple[RunRecord | None, str | None]:
    """比べる相手と、見つからないときの理由"""
    if period is None:
        return None, "対象期間（対象月）が分からないため、前回と比べていません。"
    prev = previous_period(period)
    is_demo = source == "demo"
    candidates = [
        h
        for h in history
        if h.flow_id == flow_id
        and h.period == prev
        and h.run_id != exclude_run_id
        and h.processing_status == "completed"
        and (h.source == "demo") == is_demo
        and (h.official_output.performed if category == "business" else h.verdict is not None)
    ]
    if not candidates:
        what = "正式な出力" if category == "business" else "検証"
        return None, f"比較できる前月（{period_label(prev)}）の{what}の記録がありません。"
    return max(candidates, key=lambda h: h.executed_at), None


# ---------------------------------------------------------------------------
# 比較表
# ---------------------------------------------------------------------------


def fmt_number(v: Decimal) -> str:
    v = v.normalize() if v == v.to_integral_value() else v
    if v == v.to_integral_value():
        return f"{int(v):,}"
    return f"{v:,f}"


def change_of(prev: Decimal, cur: Decimal) -> tuple[Decimal, Decimal | None]:
    """増減と増減率（%）。前回が0なら増減率は出さない"""
    diff = cur - prev
    return diff, (diff / prev * 100 if prev != 0 else None)


def signed(v: Decimal) -> str:
    return ("+" if v > 0 else "") + fmt_number(v)


def rate_text(rate: Decimal | None) -> str | None:
    return None if rate is None else f"{rate:+.1f}%"


class MetricComparison(BaseModel):
    metric_id: str
    label: str
    category: Category
    current: str
    previous: str | None = None
    diff: str | None = None
    rate: str | None = None
    status: Literal["compared", "not_comparable"]
    reason: str | None = None


class BaselineInfo(BaseModel):
    run_id: str
    period: str | None
    executed_at: str


class ComparisonReport(BaseModel):
    period: str | None
    previous_period: str | None
    business_baseline: BaselineInfo | None
    business_reason: str | None
    quality_baseline: BaselineInfo | None
    quality_reason: str | None
    rows: list[MetricComparison]


def _info(r: RunRecord | None) -> BaselineInfo | None:
    return None if r is None else BaselineInfo(run_id=r.run_id, period=r.period, executed_at=r.executed_at.isoformat())


def compare_with_history(current: RunRecord, history: list[RunRecord]) -> ComparisonReport:
    """今回の記録の指標を、前回（種類ごとに選んだ相手）と比べる"""
    bases: dict[Category, tuple[RunRecord | None, str | None]] = {
        c: select_baseline(current.flow_id, current.period, history, c, source=current.source, exclude_run_id=current.run_id)  # type: ignore[arg-type]
        for c in ("business", "quality")
    }
    rows: list[MetricComparison] = []
    for m in current.metrics:
        base, reason = bases[m.category]
        cur = Decimal(m.value)
        row = MetricComparison(metric_id=m.metric_id, label=m.label, category=m.category, current=fmt_number(cur), status="not_comparable")
        if base is None:
            row.reason = reason
        else:
            prev_m = next((x for x in base.metrics if x.metric_id == m.metric_id), None)
            if prev_m is None:
                row.reason = "前回の記録に、この数値がありません。"
            elif prev_m.fingerprint != m.fingerprint:
                row.reason = "前回から集計条件が変更されたため、比較できません。"
            else:
                prev = Decimal(prev_m.value)
                diff, rate = change_of(prev, cur)
                row.previous, row.diff, row.rate, row.status = fmt_number(prev), signed(diff), rate_text(rate), "compared"
        rows.append(row)
    return ComparisonReport(
        period=current.period,
        previous_period=previous_period(current.period) if current.period else None,
        business_baseline=_info(bases["business"][0]),
        business_reason=bases["business"][1],
        quality_baseline=_info(bases["quality"][0]),
        quality_reason=bases["quality"][1],
        rows=rows,
    )
