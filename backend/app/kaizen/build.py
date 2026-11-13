"""改善後の作業手順を作る（業務改善デモ STEP 4）。

利用者の判断（採用・保留・採用しない）から、決まった規則で
  1) 改善後の作業の流れ（人の作業と自動の処理。所要時間は想定値）
  2) 処理エンジンで実行できる作業手順（通常の作業手順と同じ形。新しい作業手順として作る）
を組み立てる。採用した候補だけを反映し、保留・採用しないの候補は反映しない（AIは使わない）。

候補ごとの反映：
  廃止（会議用資料への転記）：採用 → その工程をなくす ／ それ以外 → 手作業の工程として残す（処理エンジンでは行えない）
  標準化：採用 → 「列名を共通の列名にそろえる」処理を入れる ／ それ以外 → 部署ごとの列名のまま扱う
  簡素化：採用 → 部署の表を1つにまとめ、集計を1回にする ／ それ以外 → 部署ごとに集計する（前提：標準化）
  自動化：採用 → 実行できる作業手順を作る ／ それ以外 → 作業手順は作らず、手作業の流れだけを見直す
合計の一致の確認（業務情報の「必ず残すこと」）は、どの判断でも外さない（自動化すると完了基準になる）。

所要時間（すべて想定値）：手作業として残る部分は元の工程の時間。自動の処理そのものは人の時間を使わない（0分）とし、
人の時間は「ファイルを指定して実行する（2分）」「検証の結果と出力の内容を確認する（8分）」に計上する。
そのため、標準化・簡素化の採否は、所要時間ではなく処理ステップの形を変える（実態に合わせる）。
"""

from __future__ import annotations

import math
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

from app import ENGINE_VERSION
from app.kaizen.diagnose import Diagnosis
from app.kaizen.models import Scenario, WorkStep
from app.kaizen.scenarios import FileFacts

AUTO_MIN = 0  # 自動の処理そのもの（人の時間は使わない）
RUN_MIN = 2  # 受け取ったファイルを作業手順に指定して実行する想定時間
CHECK_MIN = 8  # 自動の検証の結果と出力の内容を、人が確認する想定時間
JST = timezone(timedelta(hours=9))
TYPE_OF_KIND = {"date": "date", "number": "integer", "text": "string"}

Status = Literal["adopt", "hold", "reject"]
Confirm = Literal["none", "exists", "unknown"]


class DecisionIn(BaseModel):
    status: Status | None = None
    confirm: Confirm | None = None
    reason: str = Field(default="", max_length=100)


class AfterStep(BaseModel):
    name: str
    mode: Literal["manual", "auto", "mixed"]  # 手作業／自動／自動＋人の確認・手作業
    minutes: int  # 想定値
    from_steps: list[str]  # もとになった現在の工程
    node_ids: list[str] = []  # 対応する処理ステップ（作業手順の中）
    criteria: list[str] = []  # 対応する完了基準（自動の検証）
    changed_by: list[str] = []  # この形になった理由の候補
    note: str = ""


class Change(BaseModel):
    candidate_id: str
    status: Status
    text: str


class Improvement(BaseModel):
    after_steps: list[AfterStep]
    flow: dict[str, Any] | None  # 自動化を採用しなかったときは None
    flow_note: str
    changes: list[Change]
    minutes_before: int
    minutes_after: int
    kept_rules: list[str]  # 改善後も残る品質の確認
    unsupported: list[str]  # 処理エンジンで行えないため、手作業のまま残る工程
    ai_used: bool = False


def decision_problems(diag: Diagnosis, decisions: dict[str, DecisionIn]) -> list[str]:
    """判断の誤り（画面と同じ規則を、サーバーでも確かめる）。空なら作れる"""
    out = []
    by_id = {c.candidate_id: c for c in diag.candidates}
    unknown = sorted(set(decisions) - set(by_id))
    if unknown:
        out.append(f"知らない候補があります（{'・'.join(unknown)}）")
    undecided = [c.candidate_id for c in diag.candidates if not (decisions.get(c.candidate_id) and decisions[c.candidate_id].status)]
    if undecided:
        out.append(f"まだ判断していない候補があります（候補{'・'.join(undecided)}）")
    for c in diag.candidates:
        d = decisions.get(c.candidate_id)
        if not d or d.status != "adopt":
            continue
        if c.confirm_question and d.confirm != "none":
            out.append(f"候補{c.candidate_id}：確認の問いに「要件はない」と答えたときだけ採用できます")
        missing = [x for x in c.depends_on if not (decisions.get(x) and decisions[x].status == "adopt")]
        if missing:
            out.append(f"候補{c.candidate_id}：前提の候補{'・'.join(missing)}を採用すると選べます")
    return out


def _label(n: int, s: WorkStep) -> str:
    return f"工程{n}「{s.name}」"


def build_improvement(sc: Scenario, facts: list[FileFacts], diag: Diagnosis, decisions: dict[str, DecisionIn], now: datetime | None = None) -> Improvement:
    status = {c.candidate_id: decisions[c.candidate_id].status for c in diag.candidates}
    cand_of = {c.direction: c for c in diag.candidates}

    def adopted(direction: str) -> bool:
        c = cand_of.get(direction)
        return c is not None and status[c.candidate_id] == "adopt"

    def cid(direction: str) -> list[str]:
        c = cand_of.get(direction)
        return [c.candidate_id] if c else []

    steps = {s.step_id: s for s in sc.steps}
    number = {s.step_id: i + 1 for i, s in enumerate(sc.steps)}
    by_action = {s.action: s for s in sc.steps}
    eliminate = cand_of.get("eliminate")
    removed = set(eliminate.target_steps) if eliminate and adopted("eliminate") else set()
    kept_rules = [r for s in sc.steps if s.must_keep for r in s.quality_rules]
    changes = _changes(diag, decisions, number, steps)

    if not adopted("automate"):
        after = _manual_after(sc, removed, adopted("simplify"), adopted("standardize"), cand_of, len(facts))
        return Improvement(
            after_steps=after,
            flow=None,
            flow_note="自動化（候補" + "".join(cid("automate")) + "）を採用しなかったため、実行できる作業手順は作りません。手作業の流れだけを見直しました。",
            changes=changes,
            minutes_before=sc.total_minutes,
            minutes_after=sum(a.minutes for a in after),
            kept_rules=kept_rules,
            unsupported=[],
        )

    flow, info = _build_flow(sc, facts, adopted("standardize"), adopted("simplify"), diag, decisions, now)
    after: list[AfterStep] = []
    receive, inspect = by_action["receive"], by_action["inspect"]
    after.append(
        AfterStep(
            name="各部署のExcelを受け取り、読み込む",
            mode="mixed",
            minutes=receive.minutes + RUN_MIN,
            from_steps=[receive.step_id, inspect.step_id],
            node_ids=info["load_nodes"],
            criteria=info["input_criteria"],
            changed_by=cid("automate"),
            note="受け取り（メール）・ファイルの指定・実行は手作業。必要な列・対象月の確認は自動の検証になります（目視の確認の代わり）。",
        )
    )
    if info["rename_nodes"]:
        after.append(
            AfterStep(
                name="共通ルールでデータを整える（列名をそろえる）",
                mode="auto",
                minutes=AUTO_MIN,
                from_steps=[inspect.step_id],
                node_ids=info["rename_nodes"],
                changed_by=cid("standardize"),
                note="部署ごとの読み替えをなくします。",
            )
        )
    agg = by_action["aggregate"]
    after.append(
        AfterStep(
            name="部署別に売上を集計する" if info["combined"] else f"部署ごとに売上を集計する（{len(facts)}部署分）",
            mode="auto",
            minutes=AUTO_MIN,
            from_steps=[agg.step_id],
            node_ids=info["aggregate_nodes"],
            changed_by=cid("simplify") + cid("automate") if info["combined"] else cid("automate"),
            note="3部署の表を1つにまとめ、1回で集計します。" if info["combined"] else "部署ごとの表のまま、部署の数だけ集計します。",
        )
    )
    rec = by_action["reconcile"]
    after.append(
        AfterStep(
            name="元データとの合計一致を検証する",
            mode="mixed",
            minutes=CHECK_MIN,
            from_steps=[rec.step_id],
            criteria=info["total_criteria"],
            changed_by=cid("automate"),
            note="必ず残す確認です。電卓での照合が自動の検証になり、結果を人が確認します。一致しなければ正式な出力を止めます。",
        )
    )
    copy, share = by_action["copy"], by_action["share"]
    transcribe = [s for s in sc.steps if s.action == "transcribe" and s.step_id not in removed]
    if transcribe:
        after.append(AfterStep(name="集計結果をExcelに出力する", mode="auto", minutes=AUTO_MIN, from_steps=[copy.step_id], node_ids=[info["output_node"]], changed_by=cid("automate")))
        for s in transcribe:
            held = eliminate and status[eliminate.candidate_id] == "hold"
            after.append(
                AfterStep(
                    name=s.name,
                    mode="manual",
                    minutes=s.minutes,
                    from_steps=[s.step_id],
                    changed_by=[eliminate.candidate_id] if eliminate else [],
                    note=("候補を保留したため、残しています。" if held else "候補を採用しなかったため、残しています。") + "会議用資料の作成は処理エンジンでは行えないため、手作業のままです。",
                )
            )
        after.append(AfterStep(name=share.name, mode="manual", minutes=share.minutes, from_steps=[share.step_id], note="資料の送付・共有は手作業のままです。"))
    else:
        after.append(
            AfterStep(
                name="集計結果をExcelに出力し、共有する",
                mode="mixed",
                minutes=AUTO_MIN + share.minutes,
                from_steps=[copy.step_id, share.step_id],
                node_ids=[info["output_node"]],
                changed_by=cid("automate") + cid("eliminate"),
                note="出力は自動。送付・共有は手作業です。会議でも、この売上集計Excelを使います。",
            )
        )
    unsupported = [_label(number[s.step_id], s) for s in sc.steps if s.action in ("transcribe", "share") and s.step_id not in removed]
    return Improvement(
        after_steps=after,
        flow=flow,
        flow_note="採用した改善案から、新しい作業手順を作りました（改善前の手順は変わりません）。処理ステップ・完了基準は、通常の作業手順と同じ画面で確認・編集・実行できます。",
        changes=changes,
        minutes_before=sc.total_minutes,
        minutes_after=sum(a.minutes for a in after),
        kept_rules=kept_rules,
        unsupported=unsupported,
    )


def _manual_after(sc: Scenario, removed: set[str], simplify: bool, standardize: bool, cand_of: dict, n_files: int) -> list[AfterStep]:
    out = []
    for s in sc.steps:
        if s.step_id in removed:
            continue
        name, minutes, note, by = s.name, s.minutes, "", []
        if simplify and s.repeats_per_department:
            name = f"{s.name}（{n_files}部署分を1つの表にまとめて1回で）"
            minutes = math.ceil(s.minutes / n_files)
            note = f"部署ごとの繰り返し{n_files}回が1回になるため、想定時間を1/{n_files}にしました（想定）。"
            by = [cand_of["simplify"].candidate_id]
        elif standardize and s.action == "inspect":
            note = "各部署に共通の列名で提出してもらい、読み替えをなくします。"
            by = [cand_of["standardize"].candidate_id]
        out.append(AfterStep(name=name, mode=s.mode, minutes=minutes, from_steps=[s.step_id], changed_by=by, note=note))
    return out


def _changes(diag: Diagnosis, decisions: dict[str, DecisionIn], number: dict[str, int], steps: dict[str, WorkStep]) -> list[Change]:
    out = []
    word = {"adopt": "採用", "hold": "保留", "reject": "採用しない"}
    for c in diag.candidates:
        st = decisions[c.candidate_id].status
        assert st is not None
        targets = "・".join(f"工程{number[s]}" for s in c.target_steps)
        if c.direction == "eliminate":
            text = f"{targets}「{steps[c.target_steps[0]].name}」をなくしました" if st == "adopt" else f"{targets}は手作業のまま残しました"
        elif c.direction == "simplify":
            text = "部署の表を1つにまとめ、集計を1回にしました" if st == "adopt" else "部署ごとに集計します"
        elif c.direction == "standardize":
            text = "列名を共通の列名にそろえる処理を入れました" if st == "adopt" else "部署ごとの列名のまま扱います"
        else:
            text = "実行できる作業手順を作りました（合計の一致は自動の検証に）" if st == "adopt" else "作業手順は作らず、手作業の流れだけを見直しました"
        out.append(Change(candidate_id=c.candidate_id, status=st, text=f"候補{c.candidate_id}（{word[st]}）：{text}"))
    return out


def _build_flow(
    sc: Scenario, facts: list[FileFacts], standardize: bool, simplify: bool, diag: Diagnosis, decisions: dict[str, DecisionIn], now: datetime | None
) -> tuple[dict[str, Any], dict[str, Any]]:
    now = now or datetime.now(JST)
    stamp = now.isoformat(timespec="seconds")
    flow_id = str(uuid.uuid4())
    std = next((c for c in diag.candidates if c.direction == "standardize"), None)
    # 部署ごとの「その部署の列名 → 共通の列名」
    rename_map: dict[str, dict[str, str]] = {f.department: {} for f in facts}
    if std:
        for d in std.column_diffs:
            for dept, name in d.names.items():
                if name != d.standard:
                    rename_map[dept][name] = d.standard

    inputs, nodes, deps, criteria = [], [], [], []
    load_nodes, rename_nodes, agg_nodes = [], [], []
    refs: list[tuple[FileFacts, str, dict[str, str]]] = []  # (ファイル, 集計に使う表の参照名, 列名の対応（使う名前 ← 共通の列名）)
    n = 0

    def node(**kw: Any) -> str:
        nonlocal n
        n += 1
        nid = f"n{n}"
        nodes.append({"node_id": nid, "confirmation_status": "confirmed", **kw})
        deps.append({"node_id": nid, "depends_on": []})  # 依存は呼び出し側で直後に設定する（読み込みは依存なし）
        return nid

    produced: dict[str, str] = {}  # 参照名 → それを作ったステップ
    for i, f in enumerate(facts, 1):
        iid, ref = f"dept{i}", f"dept{i}"
        inputs.append(
            {
                "input_id": iid,
                "label": f"{f.department}の売上",
                "file_kind": "xlsx",
                "sheet_hint": f.sheet,
                "columns": [{"name": c, "type": TYPE_OF_KIND.get(k, "string")} for c, k in zip(f.columns, f.kinds)],
            }
        )
        nid = node(node_type="load", node_name=f"{f.department}の売上を読み込む", parameters={"input_id": iid}, output_reference=ref)
        produced[ref] = nid
        load_nodes.append(nid)
        # 列の名前：標準化しないときは、その部署の列名をそのまま使う
        own = {std_name: own_name for own_name, std_name in rename_map[f.department].items()}
        names = {"amount": own.get("売上金額", "売上金額"), "date": own.get("売上日", "売上日")}
        if standardize and rename_map[f.department]:
            out_ref = f"dept{i}_std"
            text = "・".join(f"{a}→{b}" for a, b in rename_map[f.department].items())
            nid = node(
                node_type="rename_columns",
                node_name=f"{f.department}の列名を共通の列名にそろえる（{text}）",
                parameters={"renames": [{"source": a, "target": b} for a, b in rename_map[f.department].items()]},
                input_references=[ref],
                output_reference=out_ref,
            )
            deps[-1]["depends_on"] = [produced[ref]]
            produced[out_ref] = nid
            rename_nodes.append(nid)
            refs.append((f, out_ref, {"amount": "売上金額"}))
        else:
            refs.append((f, ref, {"amount": names["amount"]}))
        # 入力の確認（工程2の目視確認の代わり）：必要な列・対象月
        criteria.append(_crit(flow_id, f"c_cols{i}", f"{f.department}：必要な列がそろっている", "required_columns", {"ref": ref}, {}))
        criteria.append(
            _crit(flow_id, f"c_period{i}", f"{f.department}：対象月の伝票だけ", "period", {"ref": ref, "column": names["date"]}, {"month": {"$param": "target_month"}})
        )

    totals: list[str] = []
    sheets: list[dict[str, str]] = []
    if simplify:
        nid = node(
            node_type="concat",
            node_name=f"{len(facts)}部署の売上を1つの表にまとめる",
            parameters={"sources": [{"reference": r, "label": f.department} for f, r, _ in refs], "source_column": "部署"},
            input_references=[r for _, r, _ in refs],
            output_reference="all_sales",
        )
        deps[-1]["depends_on"] = [produced[r] for _, r, _ in refs]
        produced["all_sales"] = nid
        agg_nodes.append(nid)
        nid = node(
            node_type="aggregate",
            node_name="部署別に売上を集計する",
            parameters={
                "group_by": ["部署"],
                "aggregations": [{"function": "sum", "column": "売上金額", "output_column": "売上合計", "scale": 0}, {"function": "count", "output_column": "件数"}],
            },
            input_references=["all_sales"],
            output_reference="by_dept",
        )
        deps[-1]["depends_on"] = [produced["all_sales"]]
        produced["by_dept"] = nid
        agg_nodes.append(nid)
        criteria.append(
            _crit(flow_id, "c_total", "集計前後の売上金額が一致", "total_match", {"ref": "by_dept", "column": "売上合計"}, {"compare_ref": "all_sales", "compare_column": "売上金額", "tolerance": "0"})
        )
        totals.append("集計前後の売上金額が一致")
        criteria.append(_crit(flow_id, "c_depts", f"部署は{len(facts)}つ", "row_count", {"ref": "by_dept"}, {"min": len(facts), "max": len(facts)}, on_fail="caution"))
        sheets = [{"reference": "by_dept", "sheet_name": "部署別売上"}, {"reference": "all_sales", "sheet_name": "明細"}]
    else:
        for i, (f, r, cols) in enumerate(refs, 1):
            out_ref = f"total{i}"
            nid = node(
                node_type="aggregate",
                node_name=f"{f.department}の売上を集計する",
                parameters={
                    "group_by": [],
                    "aggregations": [{"function": "sum", "column": cols["amount"], "output_column": "売上合計", "scale": 0}, {"function": "count", "output_column": "件数"}],
                },
                input_references=[r],
                output_reference=out_ref,
            )
            deps[-1]["depends_on"] = [produced[r]]
            produced[out_ref] = nid
            agg_nodes.append(nid)
            name = f"{f.department}：集計前後の売上金額が一致"
            criteria.append(
                _crit(flow_id, f"c_total{i}", name, "total_match", {"ref": out_ref, "column": "売上合計"}, {"compare_ref": r, "compare_column": cols["amount"], "tolerance": "0"})
            )
            totals.append(name)
            sheets.append({"reference": out_ref, "sheet_name": f"{f.department}の集計"})
    out = node(
        node_type="output",
        node_name="集計結果をExcelに出力する",
        parameters={"sheets": sheets},
        input_references=[s["reference"] for s in sheets],
    )
    deps[-1]["depends_on"] = [produced[s["reference"]] for s in sheets]

    adopted = [c for c in diag.candidates if decisions[c.candidate_id].status == "adopt"]
    others = [c for c in diag.candidates if decisions[c.candidate_id].status != "adopt"]
    word = {"hold": "保留", "reject": "採用しない"}

    def why(c: Any) -> str:
        r = decisions[c.candidate_id].reason.strip()
        return f"（理由：{r}）" if r else ""

    description = (
        f"{sc.business_name}を、業務改善診断（決まった規則。AIは不使用）で見直して作った作業手順。\n"
        + "採用：" + ("、".join(f"候補{c.candidate_id}「{c.title}」{why(c)}" for c in adopted) or "なし") + "\n"
        + "反映していない：" + ("、".join(f"候補{c.candidate_id}「{c.title}」＝{word[decisions[c.candidate_id].status or 'reject']}{why(c)}" for c in others) or "なし")
    )
    flow = {
        "schema_version": "1.3",
        "engine_version": ENGINE_VERSION,
        "flow_id": flow_id,
        "flow_version": 1,
        "flow_name": f"{sc.business_name.removesuffix('業務')}（改善後）",
        "description": description[:2000],
        "created_at": stamp,
        "updated_at": stamp,
        "input_definitions": inputs,
        "nodes": nodes,
        "dependencies": deps,
        "run_parameters": [{"param_id": "target_month", "label": "対象月", "type": "month", "required": True}],
        "completion_criteria": {
            "version": 1,
            "items": criteria,
            "changelog": [{"version": 1, "changed_at": stamp, "summary": f"業務改善診断で作成（完了基準{len(criteria)}件。合計の一致は必ず残す）"}],
        },
    }
    info = {
        "load_nodes": load_nodes,
        "rename_nodes": rename_nodes,
        "aggregate_nodes": agg_nodes,
        "output_node": out,
        "combined": simplify,
        "input_criteria": [c["name"] for c in criteria if c["kind"] in ("required_columns", "period")],
        "total_criteria": totals,
    }
    return flow, info


def _crit(flow_id: str, cid: str, name: str, kind: str, target: dict[str, Any], params: dict[str, Any], on_fail: str = "critical") -> dict[str, Any]:
    return {
        "criterion_id": cid,
        "rule_id": f"{flow_id}:{cid}",
        "rule_version": 1,
        "name": name,
        "kind": kind,
        "target": target,
        "params": params,
        "on_fail": on_fail,
        "origin": "template",
    }
