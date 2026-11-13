"""業務改善診断のAPI（デモ①「その集計、本当に必要？」）。

Phase 1：業務シナリオ（業務情報・現在の7工程・部署のExcelの実際の列名と件数）を返す。
Phase 2：改善候補を決まった規則で検出し、根拠とともに返す（app/kaizen/diagnose.py）。
Phase 4：利用者の判断から、改善後の作業の流れと、実行できる作業手順を作る（app/kaizen/build.py）。
AIは使わない（ai_used は常に false。AIを使っていない結果を、AIの診断として見せない）。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.api.session import current_session
from app.config import Settings, get_settings
from app.demos.catalog import DATA_DIR
from app.files.service import accept_upload
from app.sessions.store import Session

from app.errors import AppError
from app.flow.validate import parse_flow, validate_structure
from app.kaizen.build import DecisionIn, Improvement, build_improvement, decision_problems
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


class BuildRequest(BaseModel):
    decisions: dict[str, DecisionIn]


@router.post("/kaizen/scenarios/{scenario_id}/build", response_model=Improvement)
def build_scenario(scenario_id: str, req: BuildRequest) -> Improvement:
    """採用した候補だけを反映して、改善後の作業手順を作る。判断の誤りはサーバーでも確かめる。"""
    sc = _scenario(scenario_id)
    facts = read_file_facts(sc)
    diag = diagnose(sc, facts)
    problems = decision_problems(diag, req.decisions)
    if problems:
        raise AppError(
            422,
            "KAIZEN_DECISIONS_INVALID",
            "改善候補の判断に、そろっていない点があります。",
            cause=" ／ ".join(problems),
            how_to_fix="「改善する作業を選ぶ」に戻って、判断を見直してください。",
        )
    result = build_improvement(sc, facts, diag, req.decisions)
    if result.flow is not None:
        # 作った作業手順は、通常の作業手順と同じ検証を通るものだけを返す（通らなければプログラムの誤り）
        flow = parse_flow(result.flow)
        issues = [i for i in validate_structure(flow) if i.severity == "error"]
        if issues:
            raise AppError(500, "KAIZEN_FLOW_INVALID", "改善後の作業手順を作れませんでした。", cause=" ／ ".join(i.message for i in issues))
    return result


class BindingOut(BaseModel):
    input_id: str
    file_id: str
    sheet: str | None
    header_row: int


class StartResponse(BaseModel):
    bindings: list[BindingOut]
    run_parameters: dict[str, str]


@router.post("/kaizen/scenarios/{scenario_id}/start", response_model=StartResponse)
def start_scenario(scenario_id: str, session: Session = Depends(current_session), settings: Settings = Depends(get_settings)) -> StartResponse:
    """部署のExcel（架空のデータ）をセッションに読み込み、改善後の作業手順の入力（dept1〜）に割り当てる。

    前に読み込んだ同じデモのファイルは入れ替える（利用者が自分で読み込んだファイルは消さない）。
    """
    sc = _scenario(scenario_id)
    names = {f.filename for f in sc.department_files}
    for file_id in [fid for fid, f in session.files.items() if getattr(f, "filename", None) in names]:
        del session.files[file_id]
    if len(session.files) + len(names) > settings.max_files:
        raise AppError(
            409,
            "TOO_MANY_FILES_FOR_DEMO",
            f"このデモには{len(names)}つのファイルを使いますが、読み込めるファイルは{settings.max_files}つまでです。",
            how_to_fix="「データを読み込む」の画面で、使わないファイルを削除してから、もう一度お試しください。",
        )
    bindings = []
    for i, f in enumerate(sc.department_files, 1):
        up = accept_upload(session, (DATA_DIR / f.filename).read_bytes(), f.filename, settings)
        bindings.append(BindingOut(input_id=f"dept{i}", file_id=up.file_id, sheet=f.sheet, header_row=1))
    return StartResponse(bindings=bindings, run_parameters={"target_month": sc.period})
