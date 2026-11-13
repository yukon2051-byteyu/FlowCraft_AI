"""総合判定と出力の制御（タスク2-3。docs/completion-criteria.md §6）。

「標準の確認」（処理エンジンの検証：エラー・警告）と「業務の完了基準」の評価結果をまとめ、
決まった規則で 正常／注意／重大／未検証 のどれかにする。AIは関与しない。

規則（上から順に当てはめる）：

| 総合判定   | 条件 | 出力 |
|------------|------|------|
| critical   | 処理がエラーで止まった（実行できなかった）、または on_fail=critical の基準を満たしていない | 確定した結果は出力しない。調査用の確認結果だけ |
| unverified | 重大はないが、record 以外の基準に未検証がある | 確かめられなかった項目を確認したうえで出力できる |
| caution    | 標準の確認の警告、または on_fail=caution の基準を満たしていない | 確認したうえで出力できる |
| normal     | 上のどれでもない | 出力できる |

業務の完了基準が1つもない（記録のみの基準を除く）ときは、判定が normal でも「標準の確認のみ」と示す
（業務上の正しさまで確かめたように見せない）。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from app.engine.result import RunResult

Verdict = Literal["normal", "caution", "critical", "unverified"]
ExportMode = Literal["allowed", "needs_confirmation", "report_only"]

VERDICT_LABEL = {"normal": "正常", "caution": "注意", "critical": "重大", "unverified": "未検証"}


@dataclass
class VerdictResult:
    verdict: Verdict
    # 業務の完了基準がなく、標準の確認だけで判定した
    standard_only: bool
    # 判定の結論（1文）
    headline: str
    # 判定の理由（重要な順）
    reasons: list[str] = field(default_factory=list)
    # 出力の扱い：そのまま出力できる／確認したうえで出力できる／調査用の確認結果だけ
    export: ExportMode = "allowed"
    # 基準の件数（満たしている・満たしていない・未検証・記録）
    counts: dict[str, int] = field(default_factory=dict)


def _names(items: list) -> str:
    shown = "」「".join(c.name for c in items[:3])
    more = f" ほか{len(items) - 3}件" if len(items) > 3 else ""
    return f"「{shown}」{more}"


def decide(result: RunResult) -> VerdictResult:
    criteria = list(result.criteria)
    judged = [c for c in criteria if c.on_fail != "record" and c.status != "recorded"]
    counts = {
        "passed": sum(1 for c in judged if c.status == "passed"),
        "failed": sum(1 for c in judged if c.status == "failed"),
        "unverified": sum(1 for c in judged if c.status == "unverified"),
        "not_applicable": sum(1 for c in judged if c.status == "not_applicable"),
        "recorded": len(criteria) - len(judged),
    }
    standard_only = not judged

    failed_critical = [c for c in judged if c.status == "failed" and c.on_fail == "critical"]
    failed_caution = [c for c in judged if c.status == "failed" and c.on_fail == "caution"]
    unverified = [c for c in judged if c.status == "unverified"]
    warn_steps = [(i, n) for i, n in enumerate(result.nodes) if n.status == "warning"]
    stopped = next(((i, n) for i, n in enumerate(result.nodes) if n.status == "error"), None)

    # 判定の理由（重要な順に集める）
    reasons: list[str] = []
    if result.status == "failed":
        if stopped is not None:
            reasons.append(f"ステップ{stopped[0] + 1}「{stopped[1].node_name}」で処理が止まりました。")
        else:
            reasons.append("作業手順に問題があるため、実行できませんでした。")
    if failed_critical:
        reasons.append(f"重大とした完了基準を満たしていません：{_names(failed_critical)}")
    if unverified:
        reasons.append(f"確かめられなかった完了基準があります：{_names(unverified)}")
    if failed_caution:
        reasons.append(f"注意とした完了基準を満たしていません：{_names(failed_caution)}")
    if warn_steps and result.status != "failed":
        steps = "、".join(f"ステップ{i + 1}「{n.node_name}」" for i, n in warn_steps[:3])
        reasons.append(f"標準の確認で、確認が必要なお知らせがあります：{steps}{' など' if len(warn_steps) > 3 else ''}")

    if result.status == "failed" or failed_critical:
        verdict: Verdict = "critical"
        headline = "重大な問題があります。処理結果は出力できません（調査用の確認結果は出力できます）。"
        export: ExportMode = "report_only"
    elif unverified:
        verdict = "unverified"
        headline = f"確かめられなかった完了基準が{len(unverified)}件あります。「正常」とは判定していません。"
        export = "needs_confirmation"
    elif failed_caution or warn_steps:
        verdict = "caution"
        headline = "確認が必要な点があります。内容を確かめてから出力してください。"
        export = "needs_confirmation"
    else:
        verdict = "normal"
        if standard_only:
            headline = "標準の確認で問題は見つかりませんでした（業務の完了基準は設定されていません）。"
        else:
            headline = f"完了基準（{counts['passed']}件）をすべて満たしています。"
        export = "allowed"
    return VerdictResult(verdict=verdict, standard_only=standard_only, headline=headline, reasons=reasons, export=export, counts=counts)
