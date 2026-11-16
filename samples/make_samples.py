"""
「自分のExcelで試す」用のサンプルExcelを作る（すべて架空のデータ）。

月次売上集計のひな形と同じ列の構成にしてあるので、ひな形から作った手順にもそのまま割り当てられる。
  売上実績_2026-12.xlsx            … 正常なデータ（12月分のみ）
  売上実績_2026-12_品質異常あり.xlsx … 対象月以外の日付・商品マスタにない商品コード・数量の空欄・伝票番号の重複を含む
  商品マスタ_サンプル.xlsx / 部署マスタ_サンプル.xlsx

実行方法（リポジトリの直下で）：
  backend/.venv/Scripts/python samples/make_samples.py
"""

import random
from datetime import date
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

OUT = Path(__file__).parent / "自分のExcelで試す"
random.seed(20261216)  # 何度作っても同じ中身になるように固定

DEPTS = [("D10", "東日本営業部"), ("D20", "西日本営業部"), ("D30", "法人営業部"), ("D40", "オンライン販売部")]
PRODUCTS = [
    ("P101", "ステンレスボトル", "日用品", 1800),
    ("P102", "折りたたみ傘", "日用品", 2400),
    ("P201", "ワイヤレスマウス", "PC周辺機器", 3200),
    ("P202", "USB充電器", "PC周辺機器", 2600),
    ("P203", "ノートPCスタンド", "PC周辺機器", 4500),
    ("P301", "A4コピー用紙（500枚）", "事務用品", 650),
    ("P302", "ゲルインクボールペン（10本）", "事務用品", 900),
    ("P303", "クリアファイル（20枚）", "事務用品", 480),
]


def write(path: Path, header: list[str], rows: list[list]) -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "Sheet1"
    ws.append(header)
    for c in ws[1]:
        c.font = Font(bold=True)
        c.fill = PatternFill("solid", fgColor="DDEBE7")
    for r in rows:
        ws.append(r)
    for col in ws.columns:
        width = max(len(str(c.value or "")) for c in col)
        ws.column_dimensions[col[0].column_letter].width = min(max(10, width * 2 + 2), 40)
    for c in ws["A"][1:]:
        if isinstance(c.value, date):
            c.number_format = "yyyy/mm/dd"
    wb.save(path)


def sales_rows(n: int) -> list[list]:
    rows = []
    for i in range(n):
        code, _, _, price = random.choice(PRODUCTS)
        qty = random.randint(1, 30)
        note = random.choice(["", "", "", "", "初回取引", "まとめ買い", "店頭受取"])
        rows.append([date(2026, 12, random.randint(1, 31)), f"S2612-{i + 1:04d}", random.choice(DEPTS)[0], code, qty, price, qty * price, note])
    rows.sort(key=lambda r: (r[0], r[1]))
    return rows


def main() -> None:
    OUT.mkdir(exist_ok=True)
    header = ["売上日", "伝票番号", "部署コード", "商品コード", "数量", "単価", "売上金額", "備考"]

    ok = sales_rows(120)
    write(OUT / "売上実績_2026-12.xlsx", header, ok)

    # 品質異常あり：正常なデータに、わざと問題のある行を混ぜる
    ng = [list(r) for r in ok]
    ng.append([date(2026, 11, 30), "S2612-0901", "D10", "P101", 5, 1800, 9000, "対象月以外の日付"])
    ng.append([date(2026, 12, 15), "S2612-0902", "D20", "P999", 3, 1500, 4500, "マスタにない商品コード"])
    ng.append([date(2026, 12, 20), "S2612-0903", "D30", "P201", None, 3200, None, "数量が空欄"])
    ng.append(list(ok[10]))  # 同じ伝票をもう一度（重複）
    write(OUT / "売上実績_2026-12_品質異常あり.xlsx", header, ng)

    write(OUT / "商品マスタ_サンプル.xlsx", ["商品コード", "商品名", "カテゴリ"], [[c, n, k] for c, n, k, _ in PRODUCTS])
    write(OUT / "部署マスタ_サンプル.xlsx", ["部署コード", "部署名"], [list(d) for d in DEPTS])

    total = sum(r[6] for r in ok)
    print(f"作成先：{OUT}")
    print(f"売上実績（正常）：{len(ok)}行、売上金額の合計 {total:,}円")
    print(f"売上実績（品質異常あり）：{len(ng)}行（問題のある行 4行）")


if __name__ == "__main__":
    main()
