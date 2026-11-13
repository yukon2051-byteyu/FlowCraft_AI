"""正式な出力をしてよいかの判定（品質MVP・共通基盤）。

画面の出力API・クラウドWorker・Windows Worker は、必ずこの関数で決める（画面の表示だけで決めない）。

- 処理が最後まで終わらなかった・出力する表がない：調査用の確認結果だけ
- 重大：調査用の確認結果だけ（正式な出力を止める）
- 注意・未検証：確認した（confirmed）ときだけ正式に出力する。無人実行では、案件で事前に承認していれば confirmed として扱う
- 正常：正式に出力する
"""

from __future__ import annotations

from dataclasses import dataclass

from app.criteria.verdict import ExportMode
from app.engine.result import RunResult


@dataclass(frozen=True)
class OutputDecision:
    # 判定にもとづく出力の扱い（allowed／needs_confirmation／report_only）
    mode: ExportMode
    # 正式な結果（処理結果のシート・正式なファイル）を出力するか
    official: bool
    # 確認が必要で、まだ確認されていない（画面では 409 で止め、確認を求める）
    needs_confirmation: bool
    # 正式に出力しない理由（出力するときは None）
    stop_reason: str | None


def decide_output(result: RunResult, confirmed: bool = False) -> OutputDecision:
    if result.status == "failed":
        return OutputDecision("report_only", False, False, "処理が最後まで終わらなかったため、正式な結果は出力しません。")
    if not result.outputs:
        return OutputDecision("report_only", False, False, "出力する表がないため、正式な結果は出力しません。")
    v = result.verdict
    if v is None:
        return OutputDecision("allowed", True, False, None)
    if v.export == "report_only":
        detail = f"（{v.reasons[0]}）" if v.reasons else ""
        return OutputDecision("report_only", False, False, f"処理は完了しましたが、重大な品質異常を検出したため、正式な結果の出力を停止しました。{detail}")
    if v.export == "needs_confirmation" and not confirmed:
        return OutputDecision("needs_confirmation", False, True, "確認が必要な点があるため、確認するまで正式な結果は出力しません。")
    return OutputDecision(v.export, True, False, None)
