"""性能の実測スクリプト（タスク1-16）。架空データを生成し、各工程の処理時間を測る。

使い方（backend フォルダで）：
    .venv\\Scripts\\python.exe scripts\\perf_benchmark.py [行数]

測定する工程：
  1. Excel(.xlsx) の読み取り（openpyxl）     2. 構造解析（見出し・型推定）
  3. CSV の読み取り                          4. 読込ノード（型変換）
  5. デモA相当フロー全体（読込3・列抽出・結合2・集計2）
"""

from __future__ import annotations

import io
import json
import random
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import openpyxl  # noqa: E402

from app.engine.nodes.load import Binding  # noqa: E402
from app.engine.runner import run_flow  # noqa: E402
from app.files.detect import decode_csv  # noqa: E402
from app.files.parse import read_csv, read_xlsx  # noqa: E402
from app.files.profile import build_table, profile_columns  # noqa: E402
from app.files.service import UploadedFile  # noqa: E402
from app.flow.validate import parse_flow  # noqa: E402

N_PRODUCTS = 1_000
N_DEPTS = 18
HEADER = ["売上日", "部署コード", "商品コード", "担当者", "数量", "単価", "金額", "備考"]


def make_rows(n: int) -> list[list]:
    random.seed(1)  # 毎回同じ架空データ
    d0 = datetime(2026, 10, 1)
    rows = []
    for i in range(n):
        q = random.randint(1, 20)
        p = random.choice([980, 1500, 3200, 12800])
        rows.append([d0 + timedelta(days=i % 31), f"{random.randint(1, N_DEPTS):03d}", f"P{random.randint(0, N_PRODUCTS - 1):04d}", f"担当{random.randint(1, 40)}", q, p, q * p, None])
    return rows


def to_xlsx(header: list, rows: list[list]) -> bytes:
    wb = openpyxl.Workbook(write_only=True)
    ws = wb.create_sheet("S")
    ws.append(header)
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def to_csv(header: list, rows: list[list]) -> bytes:
    def cell(v):
        if v is None:
            return ""
        if isinstance(v, datetime):
            return v.strftime("%Y/%m/%d")
        return str(v)

    lines = [",".join(header)] + [",".join(cell(v) for v in r) for r in rows]
    return ("\r\n".join(lines) + "\r\n").encode("utf-8")


def timed(label: str, fn, results: dict):
    t = time.perf_counter()
    out = fn()
    results[label] = time.perf_counter() - t
    print(f"  {label:<36} {results[label]:7.2f} 秒")
    return out


def main(n: int) -> dict:
    print(f"=== 性能測定：売上 {n:,}行 × {len(HEADER)}列、商品マスタ {N_PRODUCTS:,}行、部署マスタ {N_DEPTS}行 ===")
    results: dict[str, float] = {}
    rows = make_rows(n)
    xlsx = to_xlsx(HEADER, rows)
    csv_bytes = to_csv(HEADER, rows)
    print(f"  （ファイルサイズ：xlsx {len(xlsx) / 1024 / 1024:.1f}MB、csv {len(csv_bytes) / 1024 / 1024:.1f}MB）")

    sheets = timed("1. Excel読み取り（openpyxl）", lambda: read_xlsx(xlsx, "s.xlsx", 500, 1_000_000), results)
    timed("2. 構造解析（見出し・型推定）", lambda: profile_columns(build_table(sheets[0], 1, is_csv=False)), results)
    text, _ = decode_csv(csv_bytes, "s.csv")
    csv_sheet = timed("3. CSV読み取り", lambda: read_csv(text, "s.csv", 500, 1_000_000), results)

    flow = parse_flow(json.loads((Path(__file__).parents[1] / "tests" / "fixtures" / "flows" / "monthly_sales.json").read_text(encoding="utf-8")))
    now = datetime.now(timezone.utc)
    products = [["商品コード", "商品名"]] + [[f"P{i:04d}", f"商品{i}"] for i in range(N_PRODUCTS)]
    depts = [["部署コード", "部署名"]] + [[f"{i:03d}", f"部署{i}"] for i in range(1, N_DEPTS + 1)]
    from app.files.parse import RawSheet

    files = {
        "f1": UploadedFile("f1", "売上.xlsx", "xlsx", None, len(xlsx), now, {"S": sheets[0]}),
        "f2": UploadedFile("f2", "商品.xlsx", "xlsx", None, 1, now, {"S": RawSheet("S", False, products)}),
        "f3": UploadedFile("f3", "部署.csv", "csv", None, 1, now, {"S": RawSheet("S", False, depts)}),
    }
    bindings = {"sales": Binding("sales", "f1"), "products": Binding("products", "f2"), "depts": Binding("depts", "f3")}
    ex = timed("4. 読込ノードまで（型変換）", lambda: run_flow(flow, bindings, files, require_confirmed=False, stop_after="n1"), results)
    assert ex.result.status != "failed", ex.result.nodes[0].issues
    ex = timed("5. デモA相当フロー全体", lambda: run_flow(flow, bindings, files), results)
    assert ex.result.status != "failed", [(n.node_id, [i.message for i in n.issues]) for n in ex.result.nodes]
    print("     ノード別：" + "、".join(f"{r.node_id}={r.duration_ms / 1000:.2f}秒" for r in ex.result.nodes))
    _ = csv_sheet
    return results


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 100_000)
