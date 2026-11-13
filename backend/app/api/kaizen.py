"""業務改善診断のAPI（デモ①「その集計、本当に必要？」）。

Phase 1：業務シナリオ（業務情報・現在の7工程・部署のExcelの実際の列名と件数）を返す。
AIは使わない（ai_used は常に false。AIを使っていない結果を、AIの診断として見せない）。
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.errors import AppError
from app.kaizen.models import Scenario
from app.kaizen.scenarios import load_scenario, read_file_facts

router = APIRouter(tags=["kaizen"])


class FileFactsOut(BaseModel):
    department: str
    filename: str
    sheet: str
    columns: list[str]
    rows: int


class ScenarioResponse(BaseModel):
    scenario: Scenario
    total_minutes: int
    files: list[FileFactsOut]
    ai_used: bool = False


@router.get("/kaizen/scenarios/{scenario_id}", response_model=ScenarioResponse)
def get_scenario(scenario_id: str) -> ScenarioResponse:
    sc = load_scenario(scenario_id)
    if sc is None:
        raise AppError(404, "SCENARIO_NOT_FOUND", "この業務改善デモは見つかりません。", how_to_fix="TOP のデモの一覧から選び直してください。")
    facts = [FileFactsOut(**f.__dict__) for f in read_file_facts(sc)]
    return ScenarioResponse(scenario=sc, total_minutes=sc.total_minutes, files=facts)
