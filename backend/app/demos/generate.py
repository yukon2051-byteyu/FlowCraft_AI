"""デモ用の架空データを生成する（タスク1-0）。

M1「価値を示す3つのデモ」に使う：
  1. 先月の作業手順を、今月のExcelで再実行する
  2. 列名変更・データ欠落などを検出し、分かりやすく知らせる
  3. 検証結果を確認し、問題がなければレポートを出力する

生成するファイル（backend/app/demos/data/）：
  売上実績_2026-10.xlsx   先月分。問題のないデータ（作業手順を作る元）
  売上実績_2026-11.xlsx   今月分。下の「仕込む問題」を含む
  商品マスタ.xlsx          30商品（コードは一意）
  商品マスタ_重複あり.xlsx 同じ商品コードが2行ある（重大の判定のデモ用）
  部署マスタ.csv           Shift_JIS（CP932）。部署コードは先頭0付き
  manifest.json            仕込んだ問題の件数・行番号と、集計の正解値

  デモ（M1・docs/demo-design.md）用：
  デモ_月次売上_期間外あり.xlsx  10月分に、11月の日付の伝票を3件混ぜたもの（品質異常のデモ。原因は「対象期間外」だけ）
                                 正常のデモと「直したデータ」は 売上実績_2026-10.xlsx を使う

乱数の種（シード）を固定しているため、何度生成しても同じ内容になる。

使い方（backend フォルダで）：
    .venv\\Scripts\\python.exe -m app.demos.generate
"""

from __future__ import annotations

import json
import random
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

import openpyxl
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter

SEED = 20261112
DATA_DIR = Path(__file__).parent / "data"
FIXED_TIME = datetime(2026, 11, 1, 9, 0, 0)  # ファイルの作成日時も固定する

PRODUCTS = [
    ("P-1001", "ノートPC 14型", "PC本体", 128000),
    ("P-1002", "ノートPC 16型", "PC本体", 158000),
    ("P-1003", "デスクトップPC", "PC本体", 98000),
    ("P-1004", "タブレット 11型", "PC本体", 64800),
    ("P-1005", "液晶モニター 24型", "周辺機器", 24800),
    ("P-1006", "液晶モニター 27型", "周辺機器", 39800),
    ("P-1007", "ワイヤレスマウス", "周辺機器", 3200),
    ("P-1008", "キーボード", "周辺機器", 5400),
    ("P-1009", "USBハブ 7ポート", "周辺機器", 3980),
    ("P-1010", "Webカメラ", "周辺機器", 7800),
    ("P-1011", "ヘッドセット", "周辺機器", 6800),
    ("P-1012", "ドッキングステーション", "周辺機器", 19800),
    ("P-1013", "外付けSSD 1TB", "記憶装置", 14800),
    ("P-1014", "外付けHDD 4TB", "記憶装置", 12800),
    ("P-1015", "USBメモリ 64GB", "記憶装置", 1980),
    ("P-1016", "NAS 2ベイ", "記憶装置", 42800),
    ("P-1017", "レーザープリンター", "プリンター", 34800),
    ("P-1018", "インクジェット複合機", "プリンター", 24800),
    ("P-1019", "トナー（黒）", "消耗品", 8900),
    ("P-1020", "インクカートリッジ4色", "消耗品", 5600),
    ("P-1021", "コピー用紙 A4 5箱", "消耗品", 4500),
    ("P-1022", "LANケーブル 3m", "ネットワーク", 980),
    ("P-1023", "無線LANルーター", "ネットワーク", 15800),
    ("P-1024", "スイッチングハブ 8ポート", "ネットワーク", 6400),
    ("P-1025", "セキュリティソフト 1年", "ソフトウェア", 7480),
    ("P-1026", "オフィスソフト", "ソフトウェア", 32800),
    ("P-1027", "PC設定サービス", "サービス", 9800),
    ("P-1028", "データ移行サービス", "サービス", 14800),
    ("P-1029", "延長保証 3年", "サービス", 12000),
    ("P-1030", "出張設置サービス", "サービス", 18000),
]

DEPTS = [("001", "営業1部"), ("002", "営業2部"), ("003", "法人営業部"), ("004", "EC事業部")]
STAFF = ["青木", "石川", "上田", "江口", "大野", "加藤", "木村", "久保"]  # 架空の担当者（姓のみ）
NOTES = [None] * 9 + ["分納", "見積から変更", "初回取引"]

OCT_HEADER = ["売上日", "伝票番号", "部署コード", "商品コード", "数量", "単価", "売上金額", "備考"]
# 今月：列名の変更（売上金額→金額）、列順の変更（商品コードを部署コードの前へ）、列の追加（担当者）
NOV_HEADER = ["伝票番号", "売上日", "商品コード", "部署コード", "担当者", "数量", "単価", "金額", "備考"]


@dataclass
class Sale:
    day: date
    slip: str
    dept: str
    product: str | None
    qty: int
    price: int
    note: str | None
    staff: str

    @property
    def amount(self) -> int:
        return self.qty * self.price


def _sales(rng: random.Random, year: int, month: int, n: int, slip_start: int) -> list[Sale]:
    out = []
    for i in range(n):
        code, _, _, price = rng.choice(PRODUCTS)
        out.append(
            Sale(
                day=date(year, month, rng.randint(1, 28)),
                slip=f"S{year % 100:02d}{month:02d}-{slip_start + i:04d}",
                dept=rng.choice(DEPTS)[0],
                product=code,
                qty=rng.choice([1, 1, 1, 2, 2, 3, 5, 10]),
                price=price,
                note=rng.choice(NOTES),
                staff=rng.choice(STAFF),
            )
        )
    out.sort(key=lambda s: (s.day, s.slip))
    return out


def _save(wb: openpyxl.Workbook, path: Path) -> None:
    wb.properties.creator = "FlowCraft AI デモデータ"
    wb.properties.created = FIXED_TIME
    wb.properties.modified = FIXED_TIME
    wb.save(path)


def _write_sheet(path: Path, sheet: str, header: list[str], rows: list[list[Any]]) -> None:
    """見出しを太字・薄い色付きにし、列幅を整えた、実務に近い見た目のExcelにする。"""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet
    ws.append(header)
    for r in rows:
        ws.append(r)
    for c in ws[1]:
        c.font = Font(bold=True)
        c.fill = PatternFill("solid", fgColor="E2F4E9")
    for i, h in enumerate(header, 1):
        width = max(len(str(h)) * 2 + 2, *(len(str(r[i - 1] or "")) * 1.6 + 2 for r in rows)) if rows else 12
        ws.column_dimensions[get_column_letter(i)].width = min(width, 30)
    for row in ws.iter_rows(min_row=2):
        for c in row:
            if isinstance(c.value, (date, datetime)):
                c.number_format = "yyyy/mm/dd"
            elif isinstance(c.value, int) and header[c.column - 1] in ("単価", "売上金額", "金額"):
                c.number_format = "#,##0"
    ws.freeze_panes = "A2"
    _save(wb, path)


def generate(out_dir: Path = DATA_DIR) -> dict[str, Any]:
    rng = random.Random(SEED)
    out_dir.mkdir(parents=True, exist_ok=True)

    # ---------- 先月（10月）：問題のないデータ ----------
    oct_sales = _sales(rng, 2026, 10, 240, 1)
    _write_sheet(
        out_dir / "売上実績_2026-10.xlsx",
        "売上",
        OCT_HEADER,
        [[datetime(s.day.year, s.day.month, s.day.day), s.slip, s.dept, s.product, s.qty, s.price, s.amount, s.note] for s in oct_sales],
    )

    # ---------- 今月（11月）：問題を仕込む ----------
    nov_sales = _sales(rng, 2026, 11, 252, 1)
    planted: dict[str, Any] = {}
    data_row = {id(s): i + 2 for i, s in enumerate(nov_sales)}  # Excel上の行番号（1行目は見出し）

    def pick(k: int, exclude: set[int]) -> list[Sale]:
        cands = [s for s in nov_sales if id(s) not in exclude]
        return rng.sample(cands, k)

    used: set[int] = set()
    blanks = pick(3, used)  # 商品コードの空欄
    used |= {id(s) for s in blanks}
    for s in blanks:
        s.product = None
    unknown = pick(4, used)  # マスタにない商品コード（2種類）
    used |= {id(s) for s in unknown}
    for s, code in zip(unknown, ["P-1099", "P-1099", "P-2001", "P-2001"]):
        s.product = code
    spaced = [s for s in pick(2, used)]  # 末尾に空白のあるコード（空白を除けばマスタと一致）
    used |= {id(s) for s in spaced}
    for s in spaced:
        s.product = "P-1005 "
        s.price = 24800
    out_of_period = pick(1, used)[0]  # 対象期間外（12月）の日付
    out_of_period.day = date(2026, 12, 1)

    _write_sheet(
        out_dir / "売上実績_2026-11.xlsx",
        "売上",
        NOV_HEADER,
        [[s.slip, datetime(s.day.year, s.day.month, s.day.day), s.product, s.dept, s.staff, s.qty, s.price, s.amount, s.note] for s in nov_sales],
    )
    planted = {
        "renamed_columns": {"売上金額": "金額"},
        "added_columns": ["担当者"],
        "column_order_changed": True,
        "blank_product_code_rows": sorted(data_row[id(s)] for s in blanks),
        "unknown_product_codes": {"P-1099": 2, "P-2001": 2},
        "unknown_product_rows": sorted(data_row[id(s)] for s in unknown),
        "trailing_space_code": {"value": "P-1005 ", "rows": sorted(data_row[id(s)] for s in spaced)},
        "out_of_period_rows": [data_row[id(out_of_period)]],
    }

    # ---------- マスタ ----------
    _write_sheet(out_dir / "商品マスタ.xlsx", "商品", ["商品コード", "商品名", "カテゴリ", "標準単価"], [list(p) for p in PRODUCTS])
    dup = [list(p) for p in PRODUCTS] + [["P-1003", "デスクトップPC（旧型）", "PC本体", 89800]]
    _write_sheet(out_dir / "商品マスタ_重複あり.xlsx", "商品", ["商品コード", "商品名", "カテゴリ", "標準単価"], dup)
    with open(out_dir / "部署マスタ.csv", "w", encoding="cp932", newline="") as f:
        f.write("部署コード,部署名\r\n" + "".join(f"{c},{n}\r\n" for c, n in DEPTS))

    # ---------- 正解値（手計算の代わりに、生成した行から直接計算する） ----------
    def dept_totals(sales: list[Sale]) -> dict[str, int]:
        t: dict[str, int] = defaultdict(int)
        for s in sales:
            t[dict(DEPTS)[s.dept]] += s.amount
        return dict(sorted(t.items()))

    # ---------- デモ：月次売上集計の品質異常（対象期間外の伝票の混入だけ） ----------
    # 既存のファイルの内容を変えないよう、別の乱数（シード＋1）で作る
    demo_rng = random.Random(SEED + 1)
    mixed = [Sale(s.day, s.slip, s.dept, s.product, s.qty, s.price, s.note, s.staff) for s in oct_sales]
    extra = _sales(demo_rng, 2026, 11, 3, 901)  # 11月の伝票（商品コード・部署コードは正しい）
    for e in extra:
        e.day = date(2026, 11, demo_rng.randint(1, 5))  # 月初の伝票が、締めの後に混ざった想定
    # 10月分の途中の位置に入れる（末尾に固まっていると、目で見て気づきやすく、実際の混入に近くないため）
    positions = sorted(demo_rng.sample(range(20, len(mixed)), 3))
    for offset, (pos, e) in enumerate(zip(positions, extra)):
        mixed.insert(pos + offset, e)
    demo_ng = "デモ_月次売上_期間外あり.xlsx"
    _write_sheet(
        out_dir / demo_ng,
        "売上",
        OCT_HEADER,
        [[datetime(s.day.year, s.day.month, s.day.day), s.slip, s.dept, s.product, s.qty, s.price, s.amount, s.note] for s in mixed],
    )
    demo_rows = sorted(mixed.index(e) + 2 for e in extra)  # Excel上の行番号

    manifest = {
        "seed": SEED,
        "description": "FlowCraft AI デモ用の架空データ。実在の企業・人物・商品とは関係ありません。",
        "files": {
            "売上実績_2026-10.xlsx": {"sheet": "売上", "rows": len(oct_sales), "header": OCT_HEADER},
            "売上実績_2026-11.xlsx": {"sheet": "売上", "rows": len(nov_sales), "header": NOV_HEADER},
            "商品マスタ.xlsx": {"sheet": "商品", "rows": len(PRODUCTS)},
            "商品マスタ_重複あり.xlsx": {"sheet": "商品", "rows": len(PRODUCTS) + 1, "duplicate_codes": {"P-1003": 2}},
            "部署マスタ.csv": {"encoding": "cp932", "rows": len(DEPTS)},
            demo_ng: {"sheet": "売上", "rows": len(mixed), "header": OCT_HEADER},
        },
        "expected": {
            "2026-10": {"total_amount": sum(s.amount for s in oct_sales), "dept_totals": dept_totals(oct_sales)},
            "2026-11": {"total_amount": sum(s.amount for s in nov_sales)},
        },
        "planted_2026_11": planted,
        "demo_monthly_sales": {
            "ok_file": "売上実績_2026-10.xlsx",
            "ng_file": demo_ng,
            "target_month": "2026-10",
            "out_of_period_rows": demo_rows,
            "out_of_period_dates": sorted(e.day.isoformat() for e in extra),
            "ng_total_amount": sum(s.amount for s in mixed),
        },
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


if __name__ == "__main__":
    m = generate()
    print(json.dumps(m["planted_2026_11"], ensure_ascii=False, indent=2))
    print("先月の売上合計:", f"{m['expected']['2026-10']['total_amount']:,}円")
