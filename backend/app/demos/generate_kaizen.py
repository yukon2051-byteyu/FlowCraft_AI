"""業務改善診断デモ（デモ①「その集計、本当に必要？」）用の架空データを生成する。

月次報告資料の作成業務で、各部署から受け取る売上のExcel（2026年10月分）を3つ作る。
部署ごとに列名が少しずつ違う（＝改善候補C「集計方法を標準化」の根拠になる事実）。

  月次報告_営業1部_2026-10.xlsx     売上日／伝票番号／商品コード／数量／単価／売上金額
  月次報告_営業2部_2026-10.xlsx     日付／伝票No／商品コード／数量／単価／金額
  月次報告_法人営業部_2026-10.xlsx  売上日／伝票番号／商品CD／数量／単価／売上額
  kaizen_manifest.json              列名の違いと、部署別・全体の正解値（件数・売上金額の合計）

既存のデモのファイルは作り直さない（このモジュールは新しいファイルだけを書く）。
乱数の種を固定しているため、何度生成しても同じ内容になる。

使い方（backend フォルダで）：
    .venv\\Scripts\\python.exe -m app.demos.generate_kaizen
"""

from __future__ import annotations

import json
import random
from datetime import date, datetime
from pathlib import Path
from typing import Any

from app.demos.generate import DATA_DIR, PRODUCTS, _write_sheet

SEED = 20261114
PERIOD = (2026, 10)
SHEET = "売上"
# 標準の列名（改善後の共通ルールでそろえる先）
STANDARD = ["売上日", "伝票番号", "商品コード", "数量", "単価", "売上金額"]

# (部署名, ファイル名, 列名（STANDARD と同じ並び）, 件数, 伝票番号の頭文字)
DEPARTMENTS: list[tuple[str, str, list[str], int, str]] = [
    ("営業1部", "月次報告_営業1部_2026-10.xlsx", STANDARD, 42, "A"),
    ("営業2部", "月次報告_営業2部_2026-10.xlsx", ["日付", "伝票No", "商品コード", "数量", "単価", "金額"], 36, "B"),
    ("法人営業部", "月次報告_法人営業部_2026-10.xlsx", ["売上日", "伝票番号", "商品CD", "数量", "単価", "売上額"], 30, "C"),
]


def _rows(rng: random.Random, n: int, prefix: str) -> list[list[Any]]:
    year, month = PERIOD
    out = []
    for i in range(n):
        code, _, _, price = rng.choice(PRODUCTS)
        qty = rng.choice([1, 1, 1, 2, 2, 3, 5, 10])
        day = date(year, month, rng.randint(1, 30))
        out.append([datetime(day.year, day.month, day.day), f"{prefix}{year % 100:02d}{month:02d}-{i + 1:04d}", code, qty, price, qty * price])
    out.sort(key=lambda r: (r[0], r[1]))
    return out


def generate(out_dir: Path = DATA_DIR) -> dict[str, Any]:
    rng = random.Random(SEED)
    out_dir.mkdir(parents=True, exist_ok=True)
    files: dict[str, Any] = {}
    total_rows = 0
    total_amount = 0
    for dept, filename, header, n, prefix in DEPARTMENTS:
        rows = _rows(rng, n, prefix)
        _write_sheet(out_dir / filename, SHEET, header, rows)
        amount = sum(r[5] for r in rows)
        files[filename] = {
            "department": dept,
            "sheet": SHEET,
            "header": header,
            "renames_to_standard": {h: s for h, s in zip(header, STANDARD) if h != s},
            "rows": n,
            "amount_total": amount,
        }
        total_rows += n
        total_amount += amount
    manifest = {
        "seed": SEED,
        "description": "FlowCraft AI 業務改善診断デモ用の架空データ。実在の企業・人物・商品とは関係ありません。",
        "period": f"{PERIOD[0]}-{PERIOD[1]:02d}",
        "standard_header": STANDARD,
        "files": files,
        "total": {"rows": total_rows, "amount_total": total_amount},
    }
    (out_dir / "kaizen_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


if __name__ == "__main__":
    print(json.dumps(generate(), ensure_ascii=False, indent=2))
