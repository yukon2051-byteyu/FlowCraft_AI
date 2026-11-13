"""実行結果の記録（処理履歴・検証結果・エラー表示の元データ）。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

Severity = Literal["info", "warning", "error"]
NodeRunStatus = Literal["ok", "warning", "error", "skipped"]
RunStatus = Literal["success", "warning", "failed"]


@dataclass
class EngineIssue:
    """実行中に見つかった問題。「何が起きたか・原因・直し方」と、根拠となる具体例を持つ。"""

    code: str
    severity: Severity
    message: str
    cause: str | None = None
    how_to_fix: str | None = None
    details: dict[str, Any] = field(default_factory=dict)


class NodeFailure(Exception):
    """重大な問題でノードを続行できない。以降のノードは実行しない（設計書 §7.6）。"""

    def __init__(self, issue: EngineIssue):
        super().__init__(issue.message)
        self.issue = issue


@dataclass
class NodeRun:
    node_id: str
    node_type: str
    node_name: str
    status: NodeRunStatus
    input_rows: list[int] = field(default_factory=list)
    output_rows: int | None = None
    added_columns: list[str] = field(default_factory=list)
    removed_columns: list[str] = field(default_factory=list)
    issues: list[EngineIssue] = field(default_factory=list)
    duration_ms: int = 0


@dataclass
class OutputSheet:
    sheet_name: str
    reference: str


@dataclass
class RunResult:
    status: RunStatus
    engine_version: str
    nodes: list[NodeRun]
    flow_issues: list[EngineIssue] = field(default_factory=list)  # 実行前に見つかった問題
    outputs: list[OutputSheet] = field(default_factory=list)
    fingerprints: dict[str, str] = field(default_factory=dict)  # 参照名 → 表の指紋
    duration_ms: int = 0
    # 完了基準の評価結果（app.criteria.evaluate.CriterionResult）。本番の実行のときだけ作る
    criteria: list[Any] = field(default_factory=list)

    @property
    def can_export(self) -> bool:
        """不正な結果を成果物として出力しない（エラーがあれば出力不可）。"""
        return self.status != "failed" and bool(self.outputs)
