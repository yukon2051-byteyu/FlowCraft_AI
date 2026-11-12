"""データ結合ノード（仕様6.8・第7章「データ結合・集計の正確性保証」）。最優先要件。

左＝input_references[0]、右＝input_references[1]。次の順で検証し、重大な問題があれば止める。

 ① 事前検査   ：キー列の存在、左右のキーの型、キーが空欄の行（空欄は照合しない）
 ② 関係の判定 ：左右それぞれのキー重複を数え、実際の関係（1対1・1対多・多対1・多対多）を判定
 ③ 想定との照合：expected_relationship と違えばエラー（重複キーの例を示す）
 ④ 行数の予測 ：結合する前に、結果の行数を計算で求める
 ⑤ 結合       ：左の行順を保つ（右結合は右の行順）
 ⑥ 事後検査   ：実際の行数＝予測、金額合計の照合、未照合レコード（件数・キー・行・原因候補）

キーの正規化（key_normalization="trim"）は照合のときだけ使い、データ自体は変えない。
"""

from __future__ import annotations

import unicodedata
from collections import Counter
from decimal import Decimal
from typing import Any

from app.engine.convert import to_string
from app.engine.nodes.common import TYPE_LABEL, fail, info, require_columns, warning, with_columns
from app.engine.registry import NodeContext, NodeOutput, register
from app.engine.result import EngineIssue
from app.engine.table import ColumnSpec, Table
from app.flow.schema import JoinNode

MAX_KEYS = 20  # 画面に示す未照合キー・重複キーの数
MAX_ROWS = 20  # 画面に示す未照合レコードの数

RELATION_LABEL = {
    "one_to_one": "1対1",
    "one_to_many": "1対多",
    "many_to_one": "多対1",
    "many_to_many": "多対多",
}
HOW_LABEL = {"inner": "内部結合（両方にある行だけ）", "left": "左結合（左の行をすべて残す）", "right": "右結合（右の行をすべて残す）", "outer": "完全外部結合（両方の行をすべて残す）"}

Key = tuple[Any, ...]


# ---------------------------------------------------------------------------
# キー
# ---------------------------------------------------------------------------


def _keys(table: Table, cols: list[str], trim: bool) -> list[Key | None]:
    """各行のキー。空欄を含む行は None（照合しない）。"""
    out: list[Key | None] = []
    for i in range(table.row_count):
        k = tuple(table.data[c][i] for c in cols)
        if any(v is None for v in k):
            out.append(None)
            continue
        if trim:
            k = tuple(v.strip() if isinstance(v, str) else v for v in k)
        out.append(k)
    return out


def _key_text(k: Key) -> str:
    return " / ".join(to_string(v) or "" for v in k)


# 未照合の原因候補：この正規化をすれば一致する、という形で示す（データは変えない）
def _norm_trim(v: Any) -> Any:
    return v.strip() if isinstance(v, str) else v


def _norm_width(v: Any) -> Any:
    return unicodedata.normalize("NFKC", v) if isinstance(v, str) else v


def _norm_case(v: Any) -> Any:
    return v.lower() if isinstance(v, str) else v


def _norm_zero(v: Any) -> Any:
    if isinstance(v, str) and v.strip().isdigit():
        return v.strip().lstrip("0") or "0"
    return v


CAUSES = [
    ("TRIM", "前後の空白を取り除くと一致します", _norm_trim, "「キーの前後の空白を除いて照合する」を有効にするか、元データの空白を削除してください。"),
    ("WIDTH", "全角・半角の違いをそろえると一致します", lambda v: _norm_trim(_norm_width(v)), "元データの全角・半角をそろえてください。"),
    ("CASE", "大文字・小文字の違いをそろえると一致します", lambda v: _norm_case(_norm_trim(_norm_width(v))), "元データの大文字・小文字をそろえてください。"),
    ("LEADING_ZERO", "先頭の0の有無をそろえると一致します（例：00123 と 123）", lambda v: _norm_zero(_norm_trim(v)), "両方を同じ桁数の文字列にそろえてください（数値として読み込まれていないか確認）。"),
]


def _cause_candidates(unmatched: list[Key], other_keys: set[Key]) -> list[dict[str, Any]]:
    """照合できなかったキーについて、どう直せば一致するかの候補を調べる。"""
    found: list[dict[str, Any]] = []
    remaining = list(unmatched)
    for code, label, fn, fix in CAUSES:
        index = {tuple(fn(v) for v in k) for k in other_keys}
        hits = [k for k in remaining if tuple(fn(v) for v in k) in index]
        if hits:
            found.append({"code": code, "label": label, "count": len(hits), "examples": [_key_text(k) for k in hits[:5]], "how_to_fix": fix})
            hit_set = set(hits)
            remaining = [k for k in remaining if k not in hit_set]
    return found


# ---------------------------------------------------------------------------
# 本体
# ---------------------------------------------------------------------------


@register("join")
def run_join(node: JoinNode, inputs: list[Table], ctx: NodeContext) -> NodeOutput:
    left, right = inputs
    p = node.parameters
    name = node.node_name
    lcols = [k.left for k in p.keys]
    rcols = [k.right for k in p.keys]
    left_label, right_label = node.input_references

    # ---------- ① 事前検査 ----------
    require_columns(left, lcols, f"{name}（左：{left_label}）")
    require_columns(right, rcols, f"{name}（右：{right_label}）")
    for lc, rc in zip(lcols, rcols):
        lt, rt = left.type_of(lc), right.type_of(rc)
        if lt != rt and {lt, rt} != {"integer", "decimal"}:
            raise fail(
                "KEY_TYPE_MISMATCH",
                f"「{name}」：結合キーの型が左右で違います（左「{lc}」：{TYPE_LABEL[lt]}、右「{rc}」：{TYPE_LABEL[rt]}）。",
                cause="型が違うと、見た目が同じでも一致しません（例：文字列の「00123」と数値の123）。",
                how_to_fix="結合の前に型変換ノードで、左右のキーを同じ型（コードなら文字列）にそろえてください。",
            )

    trim = p.key_normalization == "trim"
    lkeys = _keys(left, lcols, trim)
    rkeys = _keys(right, rcols, trim)
    lcount = Counter(k for k in lkeys if k is not None)
    rcount = Counter(k for k in rkeys if k is not None)
    l_null = sum(1 for k in lkeys if k is None)
    r_null = sum(1 for k in rkeys if k is None)

    # ---------- ② 関係の判定 ----------
    l_dup = {k: n for k, n in lcount.items() if n > 1}
    r_dup = {k: n for k, n in rcount.items() if n > 1}
    actual = {(False, False): "one_to_one", (False, True): "one_to_many", (True, False): "many_to_one", (True, True): "many_to_many"}[
        (bool(l_dup), bool(r_dup))
    ]

    def dup_examples(d: dict[Key, int]) -> list[dict[str, Any]]:
        return [{"key": _key_text(k), "count": n} for k, n in sorted(d.items(), key=lambda kn: -kn[1])[:MAX_KEYS]]

    # ---------- ③ 想定との照合 ----------
    expected = p.expected_relationship
    left_must_be_unique = expected in ("one_to_one", "one_to_many")
    right_must_be_unique = expected in ("one_to_one", "many_to_one")
    violations = []
    if left_must_be_unique and l_dup:
        violations.append(("左", left_label, l_dup))
    if right_must_be_unique and r_dup:
        violations.append(("右", right_label, r_dup))
    if violations:
        parts = []
        for side, label, d in violations:
            ex = "、".join(f"「{e['key']}」{e['count']}件" for e in dup_examples(d)[:5])
            parts.append(f"{side}（{label}）のキーが重複しています：{len(d):,}種類（例：{ex}）")
        raise fail(
            "RELATIONSHIP_MISMATCH",
            f"「{name}」：想定した関係（{RELATION_LABEL[expected]}）と、実際のデータの関係（{RELATION_LABEL[actual]}）が違います。",
            cause=" ／ ".join(parts) + "。このまま結合すると行が増え、金額が重複して集計されます。",
            how_to_fix="マスタの重複を解消するか、結合キーを見直してください。重複が正しい場合は、想定する関係を変更してください。",
            expected=expected,
            actual=actual,
            left_duplicates=dup_examples(l_dup),
            right_duplicates=dup_examples(r_dup),
        )

    # ---------- ④ 行数の予測 ----------
    common = lcount.keys() & rcount.keys()
    matched_out = sum(lcount[k] * rcount[k] for k in common)
    left_matched_rows = sum(lcount[k] for k in common)
    right_matched_rows = sum(rcount[k] for k in common)
    left_unmatched_rows = left.row_count - left_matched_rows  # 空欄キーを含む
    right_unmatched_rows = right.row_count - right_matched_rows
    predicted = matched_out
    if p.how in ("left", "outer"):
        predicted += left_unmatched_rows
    if p.how in ("right", "outer"):
        predicted += right_unmatched_rows

    # ---------- ⑤ 結合 ----------
    out_cols, out_specs, sources = _output_columns(left, right, lcols, rcols, p.right_suffix, name)
    rows_l: list[int | None] = []
    rows_r: list[int | None] = []
    if p.how == "right":
        lindex: dict[Key, list[int]] = {}
        for i, k in enumerate(lkeys):
            if k is not None:
                lindex.setdefault(k, []).append(i)
        for j, k in enumerate(rkeys):
            hits = lindex.get(k, []) if k is not None else []
            for i in hits:
                rows_l.append(i)
                rows_r.append(j)
            if not hits:
                rows_l.append(None)
                rows_r.append(j)
    else:
        rindex: dict[Key, list[int]] = {}
        for j, k in enumerate(rkeys):
            if k is not None:
                rindex.setdefault(k, []).append(j)
        used_r: set[int] = set()
        for i, k in enumerate(lkeys):
            hits = rindex.get(k, []) if k is not None else []
            for j in hits:
                rows_l.append(i)
                rows_r.append(j)
                used_r.add(j)
            if not hits and p.how in ("left", "outer"):
                rows_l.append(i)
                rows_r.append(None)
        if p.how == "outer":
            for j in range(right.row_count):
                if j not in used_r:
                    rows_l.append(None)
                    rows_r.append(j)

    data: dict[str, list[Any]] = {}
    for col in out_cols:
        kind, lc, rc = sources[col]
        if kind == "key":  # キー列：左の値。左がない行（右だけの行）は右の値
            lv, rv = left.data[lc], right.data[rc]
            as_dec = out_specs[col].type == "decimal"
            vals = [lv[i] if i is not None else rv[j] for i, j in zip(rows_l, rows_r)]  # type: ignore[index]
            data[col] = [Decimal(v) if as_dec and isinstance(v, int) else v for v in vals]
        elif kind == "left":
            src = left.data[lc]
            data[col] = [src[i] if i is not None else None for i in rows_l]
        else:
            src = right.data[rc]
            data[col] = [src[j] if j is not None else None for j in rows_r]
    result = with_columns(out_cols, out_specs, data)

    # ---------- ⑥ 事後検査 ----------
    if result.row_count != predicted:  # 起こらないはずだが、念のため確認する（防御的な検査）
        raise fail(
            "ROW_COUNT_UNEXPECTED",
            f"「{name}」：結合後の行数（{result.row_count:,}）が予測（{predicted:,}）と一致しません。",
            how_to_fix="内部エラーの可能性があります。結果を使わず、開発者に連絡してください。",
        )

    issues: list[EngineIssue] = []
    multiplied = matched_out - (left_matched_rows if p.how != "right" else right_matched_rows)
    base_rows = right.row_count if p.how == "right" else left.row_count
    summary = {
        "how": p.how,
        "expected_relationship": expected,
        "actual_relationship": actual,
        "left_rows": left.row_count,
        "right_rows": right.row_count,
        "output_rows": result.row_count,
        "matched_left_rows": left_matched_rows,
        "matched_right_rows": right_matched_rows,
        "left_unmatched_rows": left_unmatched_rows,
        "right_unmatched_rows": right_unmatched_rows,
        "left_blank_key_rows": l_null,
        "right_blank_key_rows": r_null,
        "multiplied_rows": multiplied,
    }
    change = result.row_count - base_rows
    issues.append(
        info(
            "JOINED",
            f"{HOW_LABEL[p.how]}で結合しました。結合前 {base_rows:,}行 → 結合後 {result.row_count:,}行"
            f"（{'+' if change >= 0 else ''}{change:,}行）。関係：{RELATION_LABEL[actual]}（想定：{RELATION_LABEL[expected]}）",
            **summary,
        )
    )
    if multiplied > 0:
        issues.append(
            warning(
                "ROWS_MULTIPLIED",
                f"キーの重複により、行が{multiplied:,}行増えています（想定した関係：{RELATION_LABEL[expected]}）。",
                cause="同じキーに複数の行が対応したため、行が複製されています。",
                how_to_fix="金額を集計する場合は、重複して数えていないか確認してください。",
                multiplied_rows=multiplied,
            )
        )

    issues += _amount_checks(p.check_amount_columns, left, result, lkeys, common, p.how, actual, ctx, name)
    issues += _unmatched_checks(node, left, right, lkeys, rkeys, lcount, rcount, l_null, r_null, p.how, name)
    return NodeOutput(table=result, issues=issues)


def _output_columns(
    left: Table, right: Table, lcols: list[str], rcols: list[str], suffix: str, name: str
) -> tuple[list[str], dict[str, ColumnSpec], dict[str, tuple[str, str | None, str | None]]]:
    """結果の列：左の列すべて → 右の列（キー列を除く）。名前が重なる右の列には接尾辞を付ける。"""
    cols: list[str] = []
    specs: dict[str, ColumnSpec] = {}
    sources: dict[str, tuple[str, str | None, str | None]] = {}
    key_pairs = dict(zip(lcols, rcols))
    for c in left.columns:
        cols.append(c)
        if c in key_pairs:
            rc = key_pairs[c]
            lt, rt = left.type_of(c), right.type_of(rc)
            specs[c] = ColumnSpec("decimal") if lt != rt else left.specs[c]
            sources[c] = ("key", c, rc)
        else:
            specs[c] = left.specs[c]
            sources[c] = ("left", c, None)
    for c in right.columns:
        if c in rcols:
            continue
        out = c if c not in specs else f"{c}{suffix}"
        if out in specs:
            raise fail(
                "COLUMN_NAME_CONFLICT",
                f"「{name}」：右の列「{c}」の名前が、接尾辞を付けても左の列と重なります（{out}）。",
                how_to_fix="接尾辞を変えるか、結合の前に列名を変更してください。",
            )
        cols.append(out)
        specs[out] = right.specs[c]
        sources[out] = ("right", None, c)
    return cols, specs, sources


def _sum(values: list[Any]) -> Decimal:
    return sum((Decimal(v) for v in values if v is not None and not isinstance(v, bool)), Decimal(0))


def _amount_checks(
    columns: list[str], left: Table, result: Table, lkeys: list[Key | None], common: set[Key], how: str, actual: str, ctx: NodeContext, name: str
) -> list[EngineIssue]:
    """金額の整合性（設計書 §7.3）。処理内容に応じて検証ルールを切り替える。"""
    issues: list[EngineIssue] = []
    if not columns:
        return issues
    require_columns(left, columns, f"{name}（金額の照合）")
    tolerance: Decimal = ctx.validation_rules.amount_tolerance
    right_unique = actual in ("one_to_one", "many_to_one")
    for c in columns:
        if left.type_of(c) not in ("integer", "decimal"):
            raise fail("AMOUNT_COLUMN_NOT_NUMERIC", f"「{name}」：金額の照合に指定した列「{c}」が数値ではありません。", how_to_fix="数値の列を指定してください。")
        before = _sum(left.data[c])
        after = _sum(result.data[c])
        detail = {"column": c, "before": str(before), "after": str(after), "difference": str(after - before)}
        if how in ("left", "outer") and right_unique:
            # 左の行は1回ずつ結果に残るはず → 合計は一致しなければならない
            if abs(after - before) > tolerance:
                raise fail(
                    "AMOUNT_MISMATCH",
                    f"「{name}」：結合の前後で「{c}」の合計が一致しません（前：{before:,}、後：{after:,}）。",
                    how_to_fix="結果を使わず、結合キーと関係の設定を確認してください。",
                    **detail,
                )
            issues.append(info("AMOUNT_MATCHED", f"「{c}」の合計は結合の前後で一致しています（{after:,}）。", **detail))
        elif how == "inner" and right_unique:
            matched = _sum([v for v, k in zip(left.data[c], lkeys) if k is not None and k in common])
            if abs(after - matched) > tolerance:
                raise fail(
                    "AMOUNT_MISMATCH",
                    f"「{name}」：照合できた行の「{c}」の合計が、結合後の合計と一致しません。",
                    how_to_fix="結果を使わず、結合キーと関係の設定を確認してください。",
                    **detail,
                )
            excluded = before - after
            if excluded:
                issues.append(
                    warning(
                        "AMOUNT_EXCLUDED_BY_INNER_JOIN",
                        f"内部結合のため、照合できなかった行の「{c}」{excluded:,}が結果に含まれません（前：{before:,} → 後：{after:,}）。",
                        how_to_fix="すべての行を残す場合は「左結合」を選んでください。",
                        **detail,
                    )
                )
            else:
                issues.append(info("AMOUNT_MATCHED", f"「{c}」の合計は結合の前後で一致しています（{after:,}）。", **detail))
        else:
            # 右結合・行が増える関係では、合計が変わるのが正常なので一致判定はしない
            issues.append(info("AMOUNT_CHANGED", f"「{c}」の合計：結合前 {before:,} → 結合後 {after:,}（この結合方式・関係では一致判定を行いません）。", **detail))
    return issues


def _unmatched_checks(
    node: JoinNode,
    left: Table,
    right: Table,
    lkeys: list[Key | None],
    rkeys: list[Key | None],
    lcount: Counter,
    rcount: Counter,
    l_null: int,
    r_null: int,
    how: str,
    name: str,
) -> list[EngineIssue]:
    """未照合レコード（設計書 §7.4）。自動では削除せず、件数・キー・対象行・原因候補を示す。"""
    p = node.parameters
    issues: list[EngineIssue] = []
    lset, rset = set(lcount), set(rcount)

    # 「主」の側（左結合なら左）の未照合は、結果の正しさに関わるので警告またはエラー
    primary_is_left = how != "right"
    sides = [("左", left, lkeys, lset, rset, l_null, primary_is_left or how == "outer"), ("右", right, rkeys, rset, lset, r_null, not primary_is_left or how == "outer")]
    for side, table, keys, mine, other, nulls, important in sides:
        # 未照合のキーを、最初に現れた順に集める（1回のループで。大量データでも遅くならないように）
        unmatched_keys: list[Key] = []
        seen: set[Key] = set()
        rows: list[int] = []
        for i, k in enumerate(keys):
            if k is not None and k not in other:
                rows.append(i)
                if k not in seen:
                    seen.add(k)
                    unmatched_keys.append(k)
        if not unmatched_keys and not nulls:
            continue
        label = node.input_references[0] if side == "左" else node.input_references[1]
        causes = _cause_candidates(unmatched_keys, other) if unmatched_keys else []
        sample = [{"row": i + 1, "values": {c: to_string(table.data[c][i]) for c in table.columns[:8]}} for i in rows[:MAX_ROWS]]
        details = {
            "side": side,
            "input": label,
            "unmatched_rows": len(rows),
            "unmatched_keys": [_key_text(k) for k in unmatched_keys[:MAX_KEYS]],
            "unmatched_key_count": len(unmatched_keys),
            "blank_key_rows": nulls,
            "records": sample,
            "cause_candidates": causes,
        }
        parts = []
        if rows:
            parts.append(f"相手に見つからないキー {len(unmatched_keys):,}種類・{len(rows):,}行")
        if nulls:
            parts.append(f"キーが空欄の{nulls:,}行（空欄は照合しません）")
        cause_text = "／".join(f"{c['label']}：{c['count']}件（例：{'、'.join(c['examples'][:3])}）" for c in causes) or None
        fix = causes[0]["how_to_fix"] if causes else "未照合のキーと対象の行を確認してください。マスタへの登録漏れの可能性があります。"
        dropped_note = "（内部結合のため、これらの行は結果に含まれません）" if how == "inner" else "（行は削除せず残しています）" if important else ""
        message = f"{side}（{label}）に照合できなかった行があります：{'、'.join(parts)}{dropped_note}"

        if important:
            if p.unmatched_policy == "error":
                raise fail("UNMATCHED_RECORDS", f"「{name}」：{message}", cause=cause_text, how_to_fix=fix, **details)
            issues.append(warning("UNMATCHED_RECORDS", message, cause=cause_text, how_to_fix=fix, **details))
        else:
            # マスタ側の「使われなかった行」は通常問題ないため、情報として示す
            issues.append(info("UNUSED_RECORDS", f"{side}（{label}）のうち、使われなかった行が{len(rows) + nulls:,}行あります。", **details))
    return issues
