"""業務改善診断のAPI（デモ①「その集計、本当に必要？」）。

Phase 1：業務シナリオ（業務情報・現在の7工程・部署のExcelの実際の列名と件数）を返す。
Phase 2：改善候補を決まった規則で検出し、根拠とともに返す（app/kaizen/diagnose.py）。
AIは使わない（ai_used は常に false。AIを使っていない結果を、AIの診断として見せない）。
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.errors import AppError
from app.kaizen.diagnose import Diagnosis, diagnose
from app.kaizen.models import Scenario
from app.kaizen.scenarios import load_scenario, read_file_facts

router = APIRouter(tags=["kaizen"])


class FileFactsOut(BaseModel):
    department: str
    filename: str
    sheet: str
    columns: list[str]
    rows: int
    kinds: list[str]


class ScenarioResponse(BaseModel):
    scenario: Scenario
    total_minutes: int
    files: list[FileFactsOut]
    ai_used: bool = False


def _scenario(scenario_id: str) -> Scenario:
    sc = load_scenario(scenario_id)
    if sc is None:
        raise AppError(404, "SCENARIO_NOT_FOUND", "この業務改善デモは見つかりません。", how_to_fix="TOP のデモの一覧から選び直してください。")
    return sc


@router.get("/kaizen/scenarios/{scenario_id}", response_model=ScenarioResponse)
def get_scenario(scenario_id: str) -> ScenarioResponse:
    sc = _scenario(scenario_id)
    facts = [FileFactsOut(**f.__dict__) for f in read_file_facts(sc)]
    return ScenarioResponse(scenario=sc, total_minutes=sc.total_minutes, files=facts)


@router.post("/kaizen/scenarios/{scenario_id}/diagnose", response_model=Diagnosis)
def diagnose_scenario(scenario_id: str) -> Diagnosis:
    """改善候補の検出。AIは呼ばない（パスワードも求めない）。"""
    sc = _scenario(scenario_id)
    return diagnose(sc, read_file_facts(sc))
