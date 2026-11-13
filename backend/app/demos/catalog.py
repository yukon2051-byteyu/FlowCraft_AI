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
    # 品質異常のとき：何を直せば正常終了するか（直したデータ＝fixed_pattern のデータの説明。M1-3）
    fix_note: str | None = None


@dataclass(frozen=True)
class StoryImprovement:
    """改善前 → 改善後（事前に用意した改善例。AIの提案ではない）。refs は改善後を実現している処理ステップ（n…）・完了基準（c…）"""

    before: str
    after: str
    refs: tuple[str, ...]


@dataclass(frozen=True)
class StoryStep:
    """改善後の処理手順の1段（refs は実際の作業手順の処理ステップ・完了基準）"""

    label: str
    refs: tuple[str, ...]


@dataclass(frozen=True)
class DemoStory:
    """デモの STEP 1「作業を知る」・STEP 2「手順と改善を確認」の内容（デモ全面改善指示書）。

    架空の業務シナリオ。改善前の作業は説明のための例で、改善後は、このデモで実際に実行する作業手順と一致させる
    （refs の対応先が作業手順にあることを tests/test_demo_story.py で確かめる）。
    """

    business_name: str
    purpose: str
    current_work: tuple[str, ...]
    issues: tuple[str, ...]
    improvements: tuple[StoryImprovement, ...]
    steps: tuple[StoryStep, ...]


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
    story: DemoStory | None = None

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
                    fix_note="混ざっていた11月の伝票3件を取り除いた、10月分だけのファイルで再実行します。",
                ),
            },
            fixed_pattern="ok",
            story=DemoStory(
                business_name="月次売上の部署別・カテゴリ別集計",
                purpose="毎月、売上実績に商品名・カテゴリと部署名を付けて、部署別・カテゴリ別の売上集計表を作る。",
                current_work=(
                    "売上実績のExcelから、集計に使う列をコピーする",
                    "商品マスタを見ながら、商品名・カテゴリを転記する",
                    "部署マスタを見ながら、部署名を転記する",
                    "部署別とカテゴリ別に、売上を2回集計する",
                    "別の月の伝票が混ざっていないか、合計が合うかを目で確かめる",
                    "集計表をExcelにまとめる",
                ),
                issues=(
                    "マスタからの転記に手間がかかり、転記ミスが起きる",
                    "商品コードの照合漏れに気づきにくい",
                    "別の月の伝票が混ざっても気づきにくい",
                    "集計結果の正しさを、人が目で確かめている",
                ),
                improvements=(
                    StoryImprovement("商品名・カテゴリを手作業で転記", "商品マスタと自動で照合して付け加える（照合できない商品コードが0件かも自動で確認）", ("n4", "c3")),
                    StoryImprovement("部署名を手作業で転記", "部署マスタと自動で照合して付け加える", ("n6",)),
                    StoryImprovement("部署別・カテゴリ別に2回集計", "同じ表から、部署別とカテゴリ別の集計を自動で作る", ("n7", "n8")),
                    StoryImprovement("対象月・合計を目で確認", "品質ルールで毎回自動検証（対象月の伝票だけ・集計前後の合計が一致）", ("c1", "c2")),
                ),
                steps=(
                    StoryStep("売上実績・商品マスタ・部署マスタを読み込む", ("n1", "n3", "n5")),
                    StoryStep("集計に使う列を取り出す", ("n2",)),
                    StoryStep("商品マスタ・部署マスタと照合して、情報を付け加える", ("n4", "n6")),
                    StoryStep("部署別・カテゴリ別に集計する", ("n7", "n8")),
                    StoryStep("品質ルールで検証する", ("c1", "c2", "c3", "c4")),
                    StoryStep("Excelに出力する", ("n9",)),
                ),
            ),
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
                    fix_note="商品コードの空白を取り除き、全角を半角にそろえ、未登録のコードを正しいコードに直したファイルで再実行します。",
                ),
            },
            fixed_pattern="ok",
            story=DemoStory(
                business_name="売上データの商品マスタ照合",
                purpose="売上実績の商品コードを商品マスタと照合し、商品名・カテゴリを付けて、カテゴリ別の売上を集計する。",
                current_work=(
                    "売上実績の商品コードを、商品マスタで1行ずつ探す（VLOOKUP）",
                    "見つからない商品コードを、目で探して直す",
                    "カテゴリごとに売上を集計する",
                    "集計の前後で合計が合うかを、電卓で確かめる",
                ),
                issues=(
                    "表記揺れ（空白・全角）は見た目では分からず、照合漏れになる",
                    "照合できなかった行が集計から漏れても気づきにくい",
                    "確かめた結果が記録に残らない",
                ),
                improvements=(
                    StoryImprovement("VLOOKUPで1行ずつ照合", "商品マスタと自動で照合し、照合できない行は原因（未登録・空白・全角）つきで示す", ("n3",)),
                    StoryImprovement("見つからないコードを目で探す", "照合できない商品コードが0件かを、品質ルールで毎回確認（重大）", ("c1",)),
                    StoryImprovement("集計の前後の合計を電卓で照合", "集計前後の売上金額が一致するかを自動で検証", ("n4", "c2")),
                    StoryImprovement("空欄のコードに気づきにくい", "商品コードの空欄を自動で確認（注意）", ("c3",)),
                ),
                steps=(
                    StoryStep("売上実績・商品マスタを読み込む", ("n1", "n2")),
                    StoryStep("商品マスタと照合して、商品名・カテゴリを付け加える", ("n3",)),
                    StoryStep("カテゴリ別に集計する", ("n4",)),
                    StoryStep("品質ルールで検証する", ("c1", "c2", "c3")),
                    StoryStep("Excelに出力する", ("n5",)),
                ),
            ),
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
                    fix_note="二重に記録されていた伝票2件を取り除いた入出庫履歴で再実行します。",
                ),
            },
            fixed_pattern="ok",
            story=DemoStory(
                business_name="月末の在庫差異の確認",
                purpose="入出庫履歴から理論上の在庫を計算し、在庫台帳（帳簿在庫）と合わない商品を一覧にする。",
                current_work=(
                    "入出庫履歴を、商品ごとに集計する",
                    "在庫台帳に、入庫・出庫の合計を転記する",
                    "前月末在庫＋入庫−出庫で、理論在庫を計算する",
                    "帳簿在庫と比べて、差異のある商品を探す",
                ),
                issues=(
                    "同じ伝票が二重に記録されても気づきにくい（差異の原因になる）",
                    "台帳にない商品の入出庫を見落とす",
                    "差異の計算を、毎月手で作り直している",
                ),
                improvements=(
                    StoryImprovement("入出庫の合計を台帳へ転記", "商品ごとに自動で合計し、台帳と照合して付け加える（全商品を照合できるかも確認）", ("n2", "n4", "c2")),
                    StoryImprovement("理論在庫・差異を手で計算", "計算式を作業手順として保存し、毎月同じ計算をする", ("n5", "n6")),
                    StoryImprovement("二重記録に気づきにくい", "伝票番号の重複を、品質ルールで自動検出（重大）", ("c1",)),
                    StoryImprovement("差異のある商品を目で探す", "差異のある商品だけを自動で残し、一覧として記録する", ("n7", "c4")),
                ),
                steps=(
                    StoryStep("入出庫履歴・在庫台帳を読み込む", ("n1", "n3")),
                    StoryStep("商品ごとに入出庫を合計し、台帳と照合する", ("n2", "n4")),
                    StoryStep("理論在庫と差異を計算し、差異のある商品を残す", ("n5", "n6", "n7")),
                    StoryStep("品質ルールで検証する", ("c1", "c2", "c3", "c4")),
                    StoryStep("Excelに出力する", ("n8",)),
                ),
            ),
        ),
    )
}
