"""Excel レポートの中身（何をどの順で、どの重要度で見せるか）。書式（見た目）は excel.py が受け持つ。

1枚目「確認結果」：管理者・業務担当者が判断するためのレポート
  第1階層：総合判定・処理と検証の状態・正式な集計結果の出力の可否・主要な理由
  第2階層：確認すべき問題の一覧（重大 → 未検証 → 注意 → 正常 → 記録のみ）
  第3階層：完了基準ごとの詳細（判定理由・根拠の数値・該当する例・推奨対応）と、処理ステップの要約
2枚目「処理の記録」：SE が処理を追跡するための記録（実行の情報・入力ファイル・処理ステップ・詳細ログ）

判定のロジックには手を入れない（app/criteria の結果をそのまま並べ替えて見せるだけ）。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from app.engine.result import EngineIssue, RunResult

# 重要度（表示と色の区分）。色だけに頼らず、必ず文字でも示す
Level = str  # "critical"／"unverified"／"caution"／"normal"／"record"
LEVEL_LABEL = {"critical": "重大", "unverified": "未検証", "caution": "注意", "normal": "正常", "record": "記録のみ"}
LEVEL_RANK = {"critical": 0, "unverified": 1, "caution": 2, "normal": 3, "record": 4}

VERDICT_LABEL = {"normal": "正常", "caution": "注意", "critical": "重大", "unverified": "未検証"}

CRITERION_KIND_LABEL = {
    "required_columns": "必要な列がそろっている",
    "data_type": "データの形式に合っている",
    "no_blank": "空欄がない",
    "unique": "重複がない",
    "value_range": "値が範囲内にある",
    "period": "対象期間内の日付だけ",
    "total_match": "2つの結果で合計が一致する",
    "row_count": "件数が範囲内にある",
    "all_matched": "照合できない行が上限以下",
    "expected_value": "確認用の値と一致する",
    "list_rows": "条件に合う行を一覧にする",
}
CRITERION_STATUS_LABEL = {"passed": "満たしている", "failed": "満たしていない", "unverified": "未検証", "not_applicable": "対象外", "recorded": "記録"}
ON_FAIL_LABEL = {"critical": "重大", "caution": "注意", "record": "記録のみ"}
STEP_STATUS_LABEL = {"ok": "完了", "warning": "要確認", "error": "エラー", "skipped": "実行していない"}
SEVERITY_LABEL = {"info": "お知らせ", "warning": "要確認", "error": "エラー"}

# 一覧の「結果」に出す、種類ごとの要の値（根拠のどの値を短く示すか）
_KEY_EVIDENCE = {
    "period": ("期間外の件数", "期間外 {}件"),
    "all_matched": ("照合できない行", "未照合 {}行"),
    "no_blank": ("空欄の件数", "空欄 {}件"),
    "unique": ("重複している行", "重複 {}"),
    "value_range": ("範囲外の件数", "範囲外 {}件"),
    "row_count": ("件数", "{}件"),
    "total_match": ("差額", "差額 {}"),
    "expected_value": ("差", "差 {}"),
    "required_columns": ("足りない列", "足りない列：{}"),
    "data_type": ("変換できない件数", "形式に合わない値 {}件"),
    "list_rows": ("該当件数", "該当 {}件"),
}


def criterion_level(c: Any) -> Level:
    if c.on_fail == "record" or c.status in ("recorded", "not_applicable"):
        return "record"
    if c.status == "failed":
        return "critical" if c.on_fail == "critical" else "caution"
    if c.status == "unverified":
        return "unverified"
    return "normal"


def _count(text: str) -> int | None:
    m = re.match(r"^([\d,]+)", text or "")
    return int(m.group(1).replace(",", "")) if m else None


def short_result(c: Any) -> str:
    if c.status == "unverified":
        return "確かめられませんでした"
    key, fmt = _KEY_EVIDENCE.get(c.kind, ("", "{}"))
    v = c.evidence.get(key)
    return fmt.format(v) if v is not None else CRITERION_STATUS_LABEL.get(c.status, c.status)


def problem_count(c: Any) -> int | None:
    """一覧の「問題件数」。満たしていないものだけ数える（数えられない種類は空欄）"""
    if c.status != "failed":
        return 0 if c.status == "passed" else None
    key, _ = _KEY_EVIDENCE.get(c.kind, ("", ""))
    if c.kind in ("row_count", "total_match", "expected_value", "required_columns"):
        return None  # 件数・差額などは「問題の件数」ではないため
    return _count(c.evidence.get(key, ""))


def to_number(text: str) -> int | float | str:
    """分析の値（"6,112,900" など）を、Excel で数値として扱える形にする（桁区切りの書式は Excel 側で付ける）"""
    t = text.replace(",", "")
    try:
        return int(t)
    except ValueError:
        try:
            return float(t)
        except ValueError:
            return text


def format_duration(ms: int) -> str:
    """処理時間。1秒未満も 0 秒に丸めない（ミリ秒の精度で示す）"""
    if ms < 1:
        return "0.001秒未満"
    if ms < 1000:
        return f"{ms / 1000:.3f}秒"
    return f"{ms / 1000:.1f}秒"


@dataclass
class Item:
    """確認すべき問題の一覧の1行"""

    level: Level
    name: str
    result: str
    count: int | None
    action: str
    source: str  # "criterion"／"standard"


@dataclass
class Status:
    """第1階層：判定と状態"""

    verdict: str  # 正常／注意／重大／未検証／（判定なし）
    verdict_level: Level
    processing: str
    official_output: str
    basis: str
    reasons: list[str] = field(default_factory=list)


def status_of(result: RunResult, exported_results: bool) -> Status:
    v = result.verdict
    stopped = next(((i, n) for i, n in enumerate(result.nodes) if n.status == "error"), None)
    if result.status == "failed":
        processing = f"途中で停止（ステップ{stopped[0] + 1}「{stopped[1].node_name}」でエラー）" if stopped else "実行できませんでした（作業手順に問題があります）"
    else:
        processing = "完了（すべての処理ステップを実行し、確認を行いました）"
    if exported_results:
        official = "出力済み（確認したうえで出力しました）" if v is not None and v.export == "needs_confirmation" else "出力済み（このファイルの処理結果のシート）"
    elif result.status == "failed":
        official = "出力停止（処理が途中で止まったため）"
    elif v is not None and v.verdict == "critical":
        official = "出力停止（重大な問題があるため。このファイルは原因を調べるための確認結果です）"
    else:
        official = "出力していません"
    if v is None:
        return Status("判定なし", "record", processing, official, "（判定していません）", [])
    if v.standard_only:
        basis = "標準の確認のみ（業務の完了基準は設定されていません）"
    else:
        n = sum(v.counts.get(k, 0) for k in ("passed", "failed", "unverified", "not_applicable"))
        basis = f"完了基準 {n}件 と、処理の中で自動で行う確認（標準の確認）"
    # 主要な理由：判定の理由に、重大・未検証の基準の要約（何が・何件）を添える
    reasons = list(v.reasons)
    for c in sorted(result.criteria, key=lambda c: LEVEL_RANK[criterion_level(c)]):
        if criterion_level(c) in ("critical", "unverified") and len(reasons) < 6:
            reasons.append(f"「{c.name}」：{c.summary}")
    level = {"critical": "critical", "unverified": "unverified", "caution": "caution", "normal": "normal"}[v.verdict]
    return Status(VERDICT_LABEL[v.verdict], level, processing, official, basis, reasons)


def items_of(result: RunResult) -> list[Item]:
    """確認すべき問題の一覧（重要な順）。完了基準と、標準の確認（処理ステップの警告・エラー）を合わせる"""
    out: list[Item] = []
    for c in result.criteria:
        level = criterion_level(c)
        action = "対応不要" if level == "normal" else ("（判定に使わない記録）" if level == "record" else (c.how_to_fix or "内容を確かめてください。"))
        out.append(Item(level, c.name, short_result(c), problem_count(c), action, "criterion"))
    for i, n in enumerate(result.nodes):
        for issue in n.issues:
            if issue.severity not in ("warning", "error"):
                continue
            out.append(
                Item(
                    "critical" if issue.severity == "error" else "caution",
                    f"ステップ{i + 1}「{n.node_name}」（自動の確認）",
                    issue.message,
                    _issue_count(issue),
                    issue.how_to_fix or "内容を確かめてください。",
                    "standard",
                )
            )
    return sorted(out, key=lambda x: LEVEL_RANK[x.level])  # 同じ重要度の中は元の順（安定な並べ替え）


def _issue_count(issue: EngineIssue) -> int | None:
    d = issue.details
    if "unmatched_rows" in d:
        return int(d.get("unmatched_rows", 0)) + int(d.get("blank_key_rows", 0))
    for k in ("count", "duplicate_rows", "rows"):
        if isinstance(d.get(k), int):
            return int(d[k])
    return None


def step_summary(result: RunResult) -> list[tuple[str, str, str, str, str]]:
    """処理ステップの要約：(ステップ, 名前, 状態, 件数, 要点)。要点は最も重要なお知らせ1つ"""
    rows = []
    for i, n in enumerate(result.nodes):
        rows_in = "＋".join(f"{r:,}" for r in n.input_rows)
        counts = f"{rows_in} → {n.output_rows:,}" if rows_in and n.output_rows is not None else (f"{n.output_rows:,}" if n.output_rows is not None else "")
        top = sorted(n.issues, key=lambda x: {"error": 0, "warning": 1}.get(x.severity, 2))
        point = top[0].message if top and top[0].severity in ("error", "warning") else ""
        rows.append((str(i + 1), n.node_name, STEP_STATUS_LABEL.get(n.status, n.status), counts, point))
    return rows


def detailed_log(result: RunResult) -> list[tuple[str, int, str, str, str, str, str]]:
    """詳細ログ：(ログID, ステップ, 名前, 種類, 内容, 原因, 直し方)。確認が必要なものを先に、同じ重さの中は実行の順。
    ログIDは「ステップ番号-そのステップ内の順番」（元の順序を追えるように）"""
    rows = []
    for i, n in enumerate(result.nodes):
        for j, issue in enumerate(n.issues, start=1):
            rows.append((f"{i + 1}-{j}", i + 1, n.node_name, SEVERITY_LABEL.get(issue.severity, issue.severity), issue.message, issue.cause or "", issue.how_to_fix or "", issue.severity))
    order = {"error": 0, "warning": 1, "info": 2}
    rows.sort(key=lambda r: (order.get(r[7], 3), r[1]))
    return [r[:7] for r in rows]
