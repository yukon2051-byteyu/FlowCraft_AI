"""Phase 3-1：再実行時の入力の変化の検出（列構成の比較）。

前回の列構成（作業手順の入力定義）と、今回のファイルを比べる。データはすべて架空。
- 必須の列の欠落・任意の列の欠落
- 列名の変更の候補（名前・形式・並びの3点と理由。自動では対応付けない）
- 列の追加・列の順番の変化（お知らせだけで、実行は止めない）
- データの形式の変化（変換できない値の件数とExcel上の行）
- 必須の列の空欄（件数と行。表の途中の空の行は数えない）
- 利用者が承認した対応付けを当てた比較と、対応付けの誤り
"""

import json

from app.files.compare import compare_input
from app.files.profile import Table
from app.flow.schema import InputDefinition

from tests.test_save_reload import DATA, FLOW_FILE, new_server

DEF = InputDefinition.model_validate(
    {
        "input_id": "sales",
        "label": "売上実績",
        "file_kind": "xlsx",
        "columns": [
            {"name": "伝票番号", "type": "string"},
            {"name": "売上日", "type": "date"},
            {"name": "商品コード", "type": "string"},
            {"name": "売上金額", "type": "integer"},
            {"name": "備考", "type": "string", "required": False},
        ],
    }
)

BASE_COLS = ["伝票番号", "売上日", "商品コード", "売上金額", "備考"]
BASE_ROWS = [
    ["S001", "2026/10/01", "P01", 1200, None],
    ["S002", "2026/10/02", "P02", 3400, "返品あり"],
    ["S003", "2026/10/03", "P01", 560, None],
]


def table(columns, rows):
    return Table(columns=list(columns), rows=[list(r) for r in rows])


def reorder(columns, rows, order):
    idx = [columns.index(c) for c in order]
    return order, [[r[i] for i in idx] for r in rows]


def test_same_structure_has_no_changes():
    c = compare_input(DEF, table(BASE_COLS, BASE_ROWS), header_row=1)
    assert c.can_run and not c.has_changes
    assert c.missing == [] and c.added == [] and not c.order_changed and c.type_problems == [] and c.blank_required == []


def test_missing_required_column_blocks_and_suggests_rename_with_reasons():
    cols = ["伝票番号", "売上日", "商品コード", "金額", "担当者", "備考"]
    rows = [r[:3] + [r[3], "山田"] + r[4:] for r in BASE_ROWS]
    c = compare_input(DEF, table(cols, rows), header_row=1)
    assert not c.can_run
    (m,) = c.missing
    assert (m.name, m.required) == ("売上金額", True)
    # 候補は「金額」だけ（「担当者」は整数として読めないため候補にしない）
    assert [x.column for x in m.candidates] == ["金額"]
    reasons = m.candidates[0].reasons
    assert any("列名が似ています" in r for r in reasons)
    assert any("値がすべて整数として読めます" in r for r in reasons)
    assert any("前回と同じ並びです（「商品コード」の次）" in r for r in reasons)
    # 増えた列としても示す（自動では対応付けない）
    assert c.added == ["金額", "担当者"] and c.mapping_applied == {}


def test_candidates_are_ranked_by_name_type_and_position():
    cols = ["伝票番号", "売上日", "商品コード", "数量", "金額（税込）", "備考"]
    rows = [r[:3] + [2, r[3]] + r[4:] for r in BASE_ROWS]
    c = compare_input(DEF, table(cols, rows), header_row=1)
    names = [x.column for x in c.missing[0].candidates]
    # 「金額（税込）」は名前が似ていて形式も合う。「数量」は形式と並びだけが合う
    assert names[0] == "金額（税込）"
    assert set(names) == {"金額（税込）", "数量"}
    scores = [x.score for x in c.missing[0].candidates]
    assert scores == sorted(scores, reverse=True)


def test_full_width_and_spaces_are_treated_as_the_same_name():
    cols = ["伝票番号", "売上日", "商品コード", "売上 金額", "備考"]
    c = compare_input(DEF, table(cols, BASE_ROWS), header_row=1)
    top = c.missing[0].candidates[0]
    assert top.column == "売上 金額" and top.score >= 0.85


def test_unrelated_text_column_is_not_suggested_for_a_text_column():
    cols = ["伝票番号", "売上日", "品番", "売上金額", "備考", "担当者"]
    rows = [r + ["山田"] for r in BASE_ROWS]
    c = compare_input(DEF, table(cols, rows), header_row=1)
    (m,) = c.missing
    assert m.name == "商品コード"
    # 「品番」は同じ並び（売上日の次）なので候補。「担当者」は名前も並びも合わないため候補にしない
    assert [x.column for x in m.candidates] == ["品番"]


def test_missing_optional_column_does_not_block():
    cols, rows = BASE_COLS[:4], [r[:4] for r in BASE_ROWS]
    c = compare_input(DEF, table(cols, rows), header_row=1)
    assert c.can_run and c.has_changes
    assert [(m.name, m.required) for m in c.missing] == [("備考", False)]


def test_added_columns_and_changed_order_are_notices_only():
    cols, rows = reorder(BASE_COLS, BASE_ROWS, ["売上日", "伝票番号", "商品コード", "売上金額", "備考"])
    cols = cols + ["担当者"]
    rows = [r + ["山田"] for r in rows]
    c = compare_input(DEF, table(cols, rows), header_row=1)
    assert c.can_run
    assert c.added == ["担当者"]
    assert c.order_changed
    assert c.expected_order == BASE_COLS and c.actual_order[:2] == ["売上日", "伝票番号"]


def test_type_change_reports_count_and_excel_rows():
    rows = [r[:] for r in BASE_ROWS]
    rows[1][3] = "3,400円"
    rows[2][1] = "10月3日"
    c = compare_input(DEF, table(BASE_COLS, rows), header_row=3)
    assert not c.can_run
    problems = {p.name: p for p in c.type_problems}
    # 見出しが3行目なら、データの2件目は5行目
    assert problems["売上金額"].failed == 1 and problems["売上金額"].examples == [{"row": 5, "value": "3,400円"}]
    assert problems["売上日"].examples == [{"row": 6, "value": "10月3日"}]


def test_blank_values_in_required_columns_are_counted_but_do_not_block():
    rows = [r[:] for r in BASE_ROWS] + [[None] * 5] + [["S004", "2026/10/04", None, 100, None]]
    rows[0][2] = "  "
    c = compare_input(DEF, table(BASE_COLS, rows), header_row=1)
    assert c.can_run
    (b,) = c.blank_required
    # 表の途中の空の行（5行目）は数えない。任意の列「備考」の空欄も数えない
    assert (b.name, b.count, b.rows) == ("商品コード", 2, [2, 6])


def test_approved_mapping_is_applied_before_comparing():
    cols = ["伝票番号", "売上日", "商品コード", "金額", "備考"]
    c = compare_input(DEF, table(cols, BASE_ROWS), header_row=1, mapping={"金額": "売上金額"})
    assert c.can_run and c.missing == [] and c.added == []
    assert c.mapping_applied == {"金額": "売上金額"}


def test_mapping_errors_are_reported():
    cols = ["伝票番号", "売上日", "商品コード", "売上金額", "金額", "備考"]
    rows = [r[:4] + [r[3]] + r[4:] for r in BASE_ROWS]
    c = compare_input(DEF, table(cols, rows), header_row=1, mapping={"ない列": "売上金額", "金額": "売上金額", "伝票番号": "存在しない列"})
    assert not c.can_run
    assert c.mapping_errors == [
        "対応付けた列「ない列」が今回のファイルにありません。",
        "「金額」を「売上金額」に対応付けようとしましたが、今回のファイルに「売上金額」という列がすでにあります。",
        "「存在しない列」は作業手順で使う列ではありません。",
    ]


def test_two_columns_mapped_to_the_same_target_is_an_error():
    cols = ["伝票番号", "売上日", "商品コード", "金額", "金額2", "備考"]
    rows = [r[:4] + [r[3]] + r[4:] for r in BASE_ROWS]
    c = compare_input(DEF, table(cols, rows), header_row=1, mapping={"金額": "売上金額", "金額2": "売上金額"})
    assert c.mapping_errors == ["「売上金額」に、2つ以上の列が対応付けられています。"]


# ===================== API：保存した作業手順 × 新しい月のファイル =====================


def _check(client, h, flow, bindings):
    res = client.post("/api/flows/check-inputs", headers=h, json={"flow": flow, "bindings": bindings})
    assert res.status_code == 200, res.text
    return {r["input_id"]: r for r in res.json()}


def test_api_detects_renamed_column_in_next_month_file_and_rechecks_with_mapping():
    flow = json.loads(FLOW_FILE.read_text(encoding="utf-8"))
    with new_server() as c:
        h = {"X-Session-Id": c.post("/api/session").json()["session_id"]}

        def upload(name):
            return c.post("/api/files", headers=h, files={"file": (name, (DATA / name).read_bytes())}).json()["file_id"]

        sales = upload("売上実績_2026-11.xlsx")
        bindings = [
            {"input_id": "sales", "file_id": sales, "sheet": "売上"},
            {"input_id": "products", "file_id": upload("商品マスタ.xlsx"), "sheet": "商品"},
        ]
        r = _check(c, h, flow, bindings)
        s = r["sales"]
        assert s["assigned"] and not s["can_run"]
        missing = {m["name"]: m for m in s["missing"]}
        assert missing["売上金額"]["required"] and missing["売上金額"]["candidates"][0]["column"] == "金額"
        assert "担当者" in s["added"]
        assert r["products"]["can_run"]
        # 割り当てていない入力は「未割当」として返す
        assert r["depts"]["assigned"] is False and r["depts"]["can_run"] is False

        # 利用者が承認した対応付けで比べ直すと、実行できる
        bindings[0]["column_mapping"] = {"金額": "売上金額"}
        s2 = _check(c, h, flow, bindings)["sales"]
        assert s2["can_run"] and s2["mapping_applied"] == {"金額": "売上金額"}
        assert all(m["name"] != "売上金額" for m in s2["missing"])


def test_api_rejects_unknown_input_and_invalid_flow():
    flow = json.loads(FLOW_FILE.read_text(encoding="utf-8"))
    with new_server() as c:
        h = {"X-Session-Id": c.post("/api/session").json()["session_id"]}
        res = c.post("/api/flows/check-inputs", headers=h, json={"flow": flow, "bindings": [{"input_id": "nothing", "file_id": "x"}]})
        assert res.status_code == 422 and res.json()["error"]["code"] == "UNKNOWN_INPUT"
        res = c.post("/api/flows/check-inputs", headers=h, json={"flow": {"bad": 1}, "bindings": []})
        assert res.status_code == 422 and res.json()["error"]["code"] == "FLOW_SCHEMA_INVALID"
