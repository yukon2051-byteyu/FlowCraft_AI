"""業務改善診断（カイゼン）の業務情報と、現在の作業手順（手作業を含む）の形。

作業手順ファイル（処理エンジンの手順）とは別のもの：ここで表すのは「人が毎月している作業」。
改善候補の検出（決まった規則）は、この形に書かれた事実（どの工程が・何を・どこへ転記しているか、
部署ごとに繰り返しているか）と、実際のExcelの列名から行う。AIの推測は入れない。

所要時間はすべて「想定値（架空の設定値）」。実測値として扱わない。
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Text = Annotated[str, Field(min_length=1, max_length=200)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BusinessContext(_Strict):
    """改善診断のための業務の背景（指示書 §4 の表）。すべて利用者が確かめ・直せる値。"""

    purpose: Text  # 業務の目的
    frequency: Text  # 実施頻度
    minutes_per_run: Annotated[int, Field(ge=1, le=10_000)]  # 1回の所要時間（想定）
    users: Text  # 成果物を使う人
    deliverables: list[Text]  # 成果物
    pain_points: list[Text]  # 困っていること
    quality_concerns: list[Text]  # 品質上の懸念
    must_keep: list[Text]  # 必ず残すこと
    unsure_to_remove: list[Text]  # 廃止できるか不明なこと


class Deliverable(_Strict):
    deliverable_id: Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{0,39}$")]
    name: Text


class WorkStep(_Strict):
    """現在の作業の1工程。"""

    step_id: Annotated[str, Field(pattern=r"^s[0-9]{1,2}$")]
    name: Text  # 工程名
    detail: Text  # 作業内容
    minutes: Annotated[int, Field(ge=0, le=1_000)]  # 想定所要時間（分）
    mode: Literal["manual", "auto"]  # 手作業か自動処理か
    deliverable: str | None = None  # 成果物（Deliverable.deliverable_id）
    quality_rules: list[Text] = Field(default_factory=list)  # 関連する品質ルール（いまの確認のしかた）
    # 規則で使う事実
    repeats_per_department: bool = False  # 部署ごとに同じ作業を繰り返している
    transcribes_from: str | None = None  # どの工程の結果を書き写しているか（step_id）
    uses_files: bool = False  # 部署から受け取ったExcelを直接扱う


class DepartmentFile(_Strict):
    department: Text
    filename: Text  # app/demos/data の中のファイル
    sheet: Text


class Scenario(_Strict):
    scenario_id: Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{0,39}$")]
    business_name: Text
    goal: Text  # 業務の目的（一文）
    period: Annotated[str, Field(pattern=r"^\d{4}-\d{2}$")]
    time_note: Text  # 所要時間が想定値であることの説明
    context: BusinessContext
    deliverables: list[Deliverable]
    steps: Annotated[list[WorkStep], Field(min_length=1, max_length=30)]
    department_files: Annotated[list[DepartmentFile], Field(min_length=1, max_length=10)]

    @model_validator(mode="after")
    def _consistent(self) -> Scenario:
        ids = [s.step_id for s in self.steps]
        if len(set(ids)) != len(ids):
            raise ValueError("工程の識別（step_id）が重複しています")
        known = {d.deliverable_id for d in self.deliverables}
        for s in self.steps:
            if s.deliverable is not None and s.deliverable not in known:
                raise ValueError(f"工程 {s.step_id} の成果物 {s.deliverable} が、成果物の一覧にありません")
            if s.transcribes_from is not None and s.transcribes_from not in ids[: ids.index(s.step_id)]:
                raise ValueError(f"工程 {s.step_id} の転記元 {s.transcribes_from} は、それより前の工程にしてください")
        if sum(s.minutes for s in self.steps) != self.context.minutes_per_run:
            raise ValueError("工程の想定所要時間の合計が、業務の所要時間と一致しません")
        return self

    @property
    def total_minutes(self) -> int:
        return sum(s.minutes for s in self.steps)
