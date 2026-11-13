"""デモの案件の一覧（M1・docs/demo-design.md）。

各案件に「正常終了」と「品質異常」の2つの体験がある。品質異常のデータは、正常のデータに問題を入れたもの
（generate.py で作る。シード固定）。判定は、実際の処理エンジンと完了基準の評価で出す（デモのための作り込みはしない）。

まだデータのない案件は available=False（画面では「開発中」と表示し、開始できない）。
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

DATA_DIR = Path(__file__).parent / "data"
FLOWS_DIR = Path(__file__).parent / "flows"

Pattern = Literal["ok", "ng"]


@dataclass(frozen=True)
class DemoInput:
    input_id: str
    filename: str  # DATA_DIR の中のファイル
    sheet: str | None = None


@dataclass(frozen=True)
class DemoPattern:
    label: str
    description: str
    inputs: tuple[DemoInput, ...]
    run_parameters: dict[str, str]
    # 体験の手引き（何を見ればよいか）。結果の値は書かない（実際の実行結果を見てもらう）
    guide: str


@dataclass(frozen=True)
class Demo:
    demo_id: str
    title: str
    summary: str
    available: bool
    flow_file: str | None = None
    patterns: dict[str, DemoPattern] = field(default_factory=dict)
    # 品質異常の体験で、問題を直したデータ（直して再実行・修正前後の比較に使う。M1-3）
    fixed_pattern: Pattern | None = None

    def flow(self) -> dict[str, Any]:
        assert self.flow_file is not None
        return json.loads((FLOWS_DIR / self.flow_file).read_text(encoding="utf-8"))


_MASTERS = (DemoInput("products", "商品マスタ.xlsx", "商品"), DemoInput("depts", "部署マスタ.csv"))

DEMOS: dict[str, Demo] = {
    d.demo_id: d
    for d in (
        Demo(
            demo_id="monthly_sales",
            title="月次売上集計デモ",
            summary="売上に商品・部署の情報を付け、部署別・カテゴリ別に集計します。",
            available=True,
            flow_file="demo_monthly_sales.json",
            patterns={
                "ok": DemoPattern(
                    label="正常終了",
                    description="対象月（2026年10月）の伝票だけを集計・検証・出力します。",
                    inputs=(DemoInput("sales", "売上実績_2026-10.xlsx", "売上"), *_MASTERS),
                    run_parameters={"target_month": "2026-10"},
                    guide="「作業手順全体を実行する」を押すと、集計と完了基準の確認が行われます。結果の画面で、総合判定と、各基準の根拠を確かめてください。",
                ),
                "ng": DemoPattern(
                    label="品質異常",
                    description="10月分のファイルに、11月の伝票が混ざっています。",
                    inputs=(DemoInput("sales", "デモ_月次売上_期間外あり.xlsx", "売上"), *_MASTERS),
                    run_parameters={"target_month": "2026-10"},
                    guide="このファイルには問題が含まれています。「作業手順全体を実行する」を押し、何が・何件・どの行で見つかり、正式な出力がどうなるかを確かめてください。",
                ),
            },
            fixed_pattern="ok",
        ),
        Demo(
            demo_id="product_match",
            title="商品マスタ照合デモ",
            summary="売上の商品コードを商品マスタと照合し、商品名・カテゴリを付けて、カテゴリ別に集計します。",
            available=True,
            flow_file="demo_product_match.json",
            patterns={
                "ok": DemoPattern(
                    label="正常終了",
                    description="すべての商品コードが、商品マスタに登録されたとおりに書かれています。",
                    inputs=(DemoInput("sales", "売上実績_2026-10.xlsx", "売上"), DemoInput("products", "商品マスタ.xlsx", "商品")),
                    run_parameters={},
                    guide="「作業手順全体を実行する」を押すと、照合と集計、完了基準の確認が行われます。結果の画面で、照合できない行が0件であることと、その根拠を確かめてください。",
                ),
                "ng": DemoPattern(
                    label="品質異常",
                    description="一部の商品コードが、未登録のコードや、見た目では分からない表記揺れ（空白・全角）になっています。",
                    inputs=(DemoInput("sales", "デモ_商品照合_表記揺れあり.xlsx", "売上"), DemoInput("products", "商品マスタ.xlsx", "商品")),
                    run_parameters={},
                    guide="「作業手順全体を実行する」を押し、照合できない行が何行あり、原因ごとに何行ずつか、どう直せばよいかを確かめてください。",
                ),
            },
            fixed_pattern="ok",
        ),
        Demo(
            demo_id="inventory",
            title="在庫差異検出デモ",
            summary="入出庫履歴から理論上の在庫を計算し、在庫台帳と合わない商品を一覧にします。",
            available=True,
            flow_file="demo_inventory.json",
            patterns={
                "ok": DemoPattern(
                    label="正常終了",
                    description="入出庫履歴に問題はありません。在庫台帳と合わない商品（棚卸の差異）を一覧にします。",
                    inputs=(DemoInput("ledger", "デモ_在庫台帳.xlsx", "在庫"), DemoInput("moves", "デモ_入出庫履歴.xlsx", "入出庫")),
                    run_parameters={},
                    guide="「作業手順全体を実行する」を押すと、理論在庫と差異を計算し、完了基準で確かめます。差異のある商品の一覧（記録）も確かめてください。",
                ),
                "ng": DemoPattern(
                    label="品質異常",
                    description="入出庫履歴に、同じ伝票が二重に記録されています（二重計上）。",
                    inputs=(DemoInput("ledger", "デモ_在庫台帳.xlsx", "在庫"), DemoInput("moves", "デモ_入出庫履歴_重複あり.xlsx", "入出庫")),
                    run_parameters={},
                    guide="「作業手順全体を実行する」を押し、どの伝票が重複していて、正式な出力がどうなるかを確かめてください。",
                ),
            },
            fixed_pattern="ok",
        ),
    )
}
