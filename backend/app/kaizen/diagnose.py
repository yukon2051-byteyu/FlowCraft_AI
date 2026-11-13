"""改善候補の検出（決まった規則。AIは使わない）。

検討の順序は 廃止 → 簡素化 → 標準化 → 自動化。各候補は、どの工程・業務情報・Excelの列を根拠にしたかを持つ。
同じシナリオとファイルなら、いつも同じ候補・同じ根拠になる（説明できる）。

規則：
  KD-1 廃止   ：同じ工程の結果を、2つ以上の成果物へ書き写している → 2つ目以降の書き写しを廃止できないか
                 （必ず確認が要る。業務上の固有の目的があるかもしれないため、廃止を確定しない）
  KD-2 簡素化 ：部署ごとに同じ作業を繰り返している → 共通の処理に1回でまとめる（前提：列名がそろっていること）
  KD-3 標準化 ：部署のExcelで、同じ位置・同じ形式の列の名前が違う → 共通の列名にそろえる
  KD-4 自動化 ：処理エンジンで行える手作業が残っている → 保存できる作業手順に変える（できない工程は「未対応」と明示）

「必ず残すこと」に当たる工程は、廃止・簡素化の対象にしない。
所要時間はすべて想定値。候補ごとの削減時間は出さない（重なりがあるため。改善後の手順を作ってから比べる）。
"""

from __future__ import annotations

from collections import Counter
from typing import Literal

from pydantic import BaseModel

from app.kaizen.models import Scenario, WorkStep
from app.kaizen.scenarios import FileFacts

Direction = Literal["eliminate", "simplify", "standardize", "automate"]
DIRECTION_LABEL: dict[str, str] = {"eliminate": "廃止", "simplify": "簡素化", "standardize": "標準化", "automate": "自動化"}

# 処理エンジンでどこまで行えるか（作業の種類ごと。実装済みの処理ステップ・完了基準だけを書く）
Support = Literal["auto", "partial", "unsupported"]
ENGINE_SUPPORT: dict[str, tuple[Support, str]] = {
    "receive": ("partial", "Excelの読み込みは自動。部署からの受け取り（メール）は手作業のまま"),
    "inspect": ("auto", "完了基準「必要な列がそろっている」「対象期間内」で、毎回自動で確かめる"),
    "aggregate": ("auto", "処理ステップ「グループ別に集計する」"),
    "copy": ("auto", "処理ステップ「Excelに出力する」"),
    "transcribe": ("unsupported", "会議用資料（スライド・文書）の作成には対応していません"),
    "reconcile": ("auto", "完了基準「合計が一致する」（集計の前後で売上金額の合計を照合）"),
    "share": ("unsupported", "資料の送付・共有には対応していません"),
}


class Evidence(BaseModel):
    source: Literal["step", "context", "file"]  # 工程の事実／業務情報／Excelの列
    ref: str  # step_id・業務情報の項目名・ファイル名
    text: str


class ColumnDiff(BaseModel):
    """部署のExcelで名前が違う列（同じ位置・同じ形式）。standard は多数決（同数なら先のファイル）。"""

    position: int  # 1始まり
    standard: str
    names: dict[str, str]  # 部署 → その部署での列名


class Candidate(BaseModel):
    candidate_id: str  # A, B, C, D
    rule_id: str  # KD-1〜KD-4
    direction: Direction
    direction_label: str
    title: str
    detail: str  # 改善内容
    target_steps: list[str]
    evidence: list[Evidence]  # 判断の根拠
    effect: str  # 想定効果（文章。時間の数値は出さない）
    checks: list[str]  # 実施前の確認事項
    # 採用する前に、利用者が「はい」と確かめる必要がある問い（廃止のとき）
    confirm_question: str | None = None
    depends_on: list[str] = []  # 前提になる候補
    unsupported_steps: list[str] = []  # 処理エンジンで行えない工程（自動化の候補で明示）
    column_diffs: list[ColumnDiff] = []


class KeptStep(BaseModel):
    step_id: str
    reason: str


class Diagnosis(BaseModel):
    candidates: list[Candidate]
    kept: list[KeptStep]  # 見直しの対象にしなかった工程と、その理由
    method: str = "決まった規則による検出（AIは使っていません）"
    ai_used: bool = False


def _names(steps: list[WorkStep]) -> str:
    return "・".join(f"工程{s.step_id[1:]}" for s in steps)


def column_diffs(facts: list[FileFacts]) -> list[ColumnDiff]:
    """同じ位置・同じ形式の列で、名前が部署によって違うものを返す。列数や形式が違う位置は対象にしない（推測しない）。"""
    if len(facts) < 2 or len({len(f.columns) for f in facts}) != 1:
        return []
    out = []
    for i in range(len(facts[0].columns)):
        names = [f.columns[i] for f in facts]
        kinds = {f.kinds[i] for f in facts}
        if len(set(names)) == 1 or len(kinds) != 1:
            continue
        counts = Counter(names)
        top = max(counts.values())
        standard = next(n for n in names if counts[n] == top)
        out.append(ColumnDiff(position=i + 1, standard=standard, names={f.department: f.columns[i] for f in facts}))
    return out


def diagnose(sc: Scenario, facts: list[FileFacts]) -> Diagnosis:
    steps = {s.step_id: s for s in sc.steps}
    deliverable = {d.deliverable_id: d.name for d in sc.deliverables}
    candidates: list[Candidate] = []
    kept = [KeptStep(step_id=s.step_id, reason=f"業務情報の「必ず残すこと」（{'・'.join(sc.context.must_keep)}）に当たるため") for s in sc.steps if s.must_keep]
    keep_ids = {k.step_id for k in kept}
    letters = iter("ABCDEFGH")

    # KD-1 廃止：同じ結果を2つ以上の成果物へ書き写している
    by_source: dict[str, list[WorkStep]] = {}
    for s in sc.steps:
        if s.transcribes_from and s.step_id not in keep_ids:
            by_source.setdefault(s.transcribes_from, []).append(s)
    for src, copies in by_source.items():
        if len(copies) < 2:
            continue
        first, extra = copies[0], copies[1:]
        for s in extra:
            ev = [
                Evidence(source="step", ref=src, text=f"工程{src[1:]}「{steps[src].name}」の結果を、{_names(copies)}で書き写しています。"),
                Evidence(
                    source="step",
                    ref=s.step_id,
                    text=f"成果物が2つあります：{'・'.join(deliverable[c.deliverable] for c in copies if c.deliverable)}（同じ数値）。",
                ),
            ]
            ev += [Evidence(source="context", ref="pain_points", text=f"業務情報「困っていること」：{p}") for p in sc.context.pain_points]
            ev += [Evidence(source="context", ref="quality_concerns", text=f"業務情報「品質上の懸念」：{q}") for q in sc.context.quality_concerns if "転記" in q]
            ev += [Evidence(source="context", ref="unsure_to_remove", text=f"業務情報「廃止できるか不明なこと」：{u}") for u in sc.context.unsure_to_remove]
            name = deliverable.get(s.deliverable or "", "資料")
            candidates.append(
                Candidate(
                    candidate_id=next(letters),
                    rule_id="KD-1",
                    direction="eliminate",
                    direction_label="廃止",
                    title=f"{name.removesuffix('報告資料').removesuffix('資料')}資料への重複転記を廃止",
                    detail=f"「{name}」への個別の書き写しをやめ、{deliverable.get(first.deliverable or '', '集計結果')}を会議でもそのまま使います。",
                    target_steps=[s.step_id],
                    evidence=ev,
                    effect="同じ数値の書き写しが1回減り、転記ミスの起きる箇所がなくなります。",
                    checks=[
                        f"「{name}」を、誰が・何のために使っているか",
                        "法令・監査・内部統制・社内規程で、別の資料として作る必要がないか",
                    ],
                    confirm_question=f"{name.removesuffix('報告資料').removesuffix('資料')}資料への転記は、独立した承認・監査・報告上の要件がありますか？",
                )
            )

    # KD-3 標準化（KD-2 の前提になるため先に調べる）
    diffs = column_diffs(facts)
    std_id: str | None = None
    repeated = [s for s in sc.steps if s.repeats_per_department and s.step_id not in keep_ids]

    # KD-2 簡素化：部署ごとの繰り返し
    simplify: Candidate | None = None
    if repeated and len(facts) >= 2:
        simplify = Candidate(
            candidate_id="",
            rule_id="KD-2",
            direction="simplify",
            direction_label="簡素化",
            title="部署別の個別集計を簡素化",
            detail=f"{len(facts)}部署のExcelを1つの表にまとめ、確認と集計を1回で行います（部署は列として残し、部署別の集計結果は変わりません）。",
            target_steps=[s.step_id for s in repeated],
            evidence=[
                Evidence(source="step", ref=s.step_id, text=f"工程{s.step_id[1:]}「{s.name}」を、部署ごとに{len(facts)}回くり返しています。")
                for s in repeated
            ]
            + [Evidence(source="file", ref=f.filename, text=f"{f.department}：{f.filename}（{f.rows}件）") for f in facts],
            effect=f"同じ作業の繰り返しが{len(facts)}回から1回になります。部署が増えても手順は増えません。",
            checks=["部署ごとに、集計の条件（対象とする伝票など）が違わないか"],
        )

    standardize: Candidate | None = None
    if diffs:
        standardize = Candidate(
            candidate_id="",
            rule_id="KD-3",
            direction="standardize",
            direction_label="標準化",
            title="集計方法を標準化",
            detail="部署ごとに違う列名を、共通の列名にそろえるルールを作業手順に入れます。あわせて、提出してもらうExcelの列名の統一をお願いすると、読み替えそのものが不要になります。",
            target_steps=[s.step_id for s in sc.steps if s.action == "inspect" and s.uses_files],
            evidence=[
                Evidence(
                    source="file",
                    ref=f"列{d.position}",
                    text=f"{d.position}列目：" + "／".join(f"{dept}「{n}」" for dept, n in d.names.items()) + f" → 共通の列名「{d.standard}」",
                )
                for d in diffs
            ],
            effect="部署ごとの読み替えがなくなり、同じ手順ですべての部署のファイルを扱えます。",
            checks=["共通の列名を、各部署に伝えられるか", "列の意味（例：税込か税抜か）が部署で同じか"],
            column_diffs=diffs,
        )

    if simplify:
        simplify.candidate_id = next(letters)
        candidates.append(simplify)
    if standardize:
        standardize.candidate_id = next(letters)
        std_id = standardize.candidate_id
        candidates.append(standardize)
        if simplify:
            simplify.depends_on = [std_id]
            simplify.checks.append(f"1つの表にまとめるには、列名をそろえる必要があります（候補{std_id}）")

    # KD-4 自動化：処理エンジンで行える手作業
    manual = [s for s in sc.steps if s.mode == "manual"]
    doable = [s for s in manual if ENGINE_SUPPORT[s.action][0] != "unsupported"]
    unsupported = [s for s in manual if ENGINE_SUPPORT[s.action][0] == "unsupported"]
    if doable:
        candidates.append(
            Candidate(
                candidate_id=next(letters),
                rule_id="KD-4",
                direction="automate",
                direction_label="自動化",
                title="残った集計を自動化",
                detail="必要な集計と品質の確認を、保存して毎月再実行できる作業手順に変えます。",
                target_steps=[s.step_id for s in doable],
                evidence=[
                    Evidence(source="step", ref=s.step_id, text=f"工程{s.step_id[1:]}「{s.name}」→ {ENGINE_SUPPORT[s.action][1]}")
                    for s in doable
                ]
                + [
                    Evidence(source="step", ref=s.step_id, text=f"工程{s.step_id[1:]}「{s.name}」→ 未対応：{ENGINE_SUPPORT[s.action][1]}")
                    for s in unsupported
                ],
                effect="毎月の集計と確認が、ファイルを指定して実行するだけになります。元データとの合計照合は、自動の検証として残ります。",
                checks=["作業手順を保存し、来月も同じ手順で実行できるか（列名が変わったら知らせます）"],
                unsupported_steps=[s.step_id for s in unsupported],
            )
        )
    return Diagnosis(candidates=candidates, kept=kept)
