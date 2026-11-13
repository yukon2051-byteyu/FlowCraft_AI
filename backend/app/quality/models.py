"""実行の記録（品質の履歴1件）の型。処理エンジンに依存しない（前回比較・Worker・保存先から使う）。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

RECORD_VERSION = 1

RunSource = Literal["manual", "worker", "demo"]


class InputRecord(BaseModel):
    input_id: str
    label: str
    filename: str | None
    sheet: str | None
    sha256: str | None
    rows: int | None
    column_mapping: dict[str, str] = Field(default_factory=dict)


class OutputRecord(BaseModel):
    reference: str
    sheet_name: str
    rows: int | None
    fingerprint: str | None


class CopySource(BaseModel):
    rule_id: str
    rule_version: int


class RuleRecord(BaseModel):
    """適用した品質ルール1つと、その判定"""

    criterion_id: str
    rule_id: str
    rule_version: int
    copied_from: CopySource | None
    name: str
    kind: str
    on_fail: str
    # 実行した時点のルールの設定の写し（作業手順の完了基準の1項目そのもの）
    snapshot: dict[str, Any]
    status: str
    summary: str
    evidence: dict[str, str]
    examples: list[dict[str, Any]]
    # 異常の件数（件数で表せない種類は None）
    anomaly_count: int | None


class OfficialOutputRecord(BaseModel):
    mode: Literal["allowed", "needs_confirmation", "report_only"]
    # 正式な結果を出力したか（画面では出力した後、Worker では正式なファイルを確定した後に True にする）
    performed: bool = False
    performed_at: datetime | None = None
    stop_reason: str | None = None


class MetricRecord(BaseModel):
    """前回と比べる数値（指標）1つ"""

    metric_id: str
    label: str
    # business：業務の数値（件数・合計）／quality：品質異常の件数
    category: Literal["business", "quality"]
    # 数値（小数も正確に扱うため文字列）
    value: str
    # 定義の指紋：指標の設定と、その数値を作るまでの上流のステップの設定から作る。違えば前回と比べない
    fingerprint: str


class RunRecord(BaseModel):
    record_version: int = RECORD_VERSION
    run_id: str
    source: RunSource
    executed_at: datetime
    duration_ms: int

    flow_id: str
    flow_name: str
    flow_version: int
    flow_hash: str
    criteria_version: int

    # 対象期間（実行時に指定する「月」の値。例 "2026-10"）。分からなければ None（前回比較はしない）
    period: str | None
    run_parameters: dict[str, str]

    inputs: list[InputRecord]
    outputs: list[OutputRecord]
    # 処理の状態（品質の判定とは別）：completed＝最後まで処理した／failed＝途中で止まった
    processing_status: Literal["completed", "failed"]
    steps: int

    verdict: str | None
    verdict_headline: str | None
    verdict_reasons: list[str]
    rules: list[RuleRecord]
    official_output: OfficialOutputRecord
    metrics: list[MetricRecord] = Field(default_factory=list)
    # 分析（app/analysis/engine.py の AnalysisReport。集計済みの値だけ）
    analysis: dict[str, Any] | None = None
