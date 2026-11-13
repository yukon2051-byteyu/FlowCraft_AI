"""デモAPI（M1）：デモの案件の一覧と、デモの開始。

開始すると、デモのファイルを利用者のセッションに読み込み、作業手順（完了基準つき）・ファイルの割当・
実行時に指定する値を返す。以後の操作（中身を見る・実行・結果・Excel）は、通常の作業と同じ画面と API を使う。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.api.session import current_session
from app.config import Settings, get_settings
from app.demos.catalog import DATA_DIR, DEMOS, Pattern
from app.errors import AppError
from app.files.service import accept_upload
from app.sessions.store import Session

router = APIRouter(tags=["demos"])


class PatternOut(BaseModel):
    label: str
    description: str


class DemoOut(BaseModel):
    demo_id: str
    title: str
    summary: str
    available: bool
    patterns: dict[str, PatternOut]


class StartRequest(BaseModel):
    pattern: Pattern


class BindingOut(BaseModel):
    input_id: str
    file_id: str
    sheet: str | None
    header_row: int


class StartResponse(BaseModel):
    demo_id: str
    title: str
    pattern: Pattern
    pattern_label: str
    description: str
    guide: str
    flow: dict[str, Any]
    bindings: list[BindingOut]
    run_parameters: dict[str, str]


@router.get("/demos", response_model=list[DemoOut])
def list_demos() -> list[DemoOut]:
    return [
        DemoOut(
            demo_id=d.demo_id,
            title=d.title,
            summary=d.summary,
            available=d.available,
            patterns={k: PatternOut(label=p.label, description=p.description) for k, p in d.patterns.items()},
        )
        for d in DEMOS.values()
    ]


@router.post("/demos/{demo_id}/start", response_model=StartResponse)
def start_demo(demo_id: str, req: StartRequest, session: Session = Depends(current_session), settings: Settings = Depends(get_settings)) -> StartResponse:
    demo = DEMOS.get(demo_id)
    if demo is None or not demo.available:
        raise AppError(404, "DEMO_NOT_FOUND", "このデモは見つからないか、まだ使えません。", how_to_fix="TOP のデモの一覧から選び直してください。")
    pattern = demo.patterns[req.pattern]

    # 前に開始したデモのファイルは入れ替える（利用者が自分で読み込んだファイルは消さない）
    demo_names = {i.filename for d in DEMOS.values() for p in d.patterns.values() for i in p.inputs}
    for file_id in [fid for fid, f in session.files.items() if getattr(f, "filename", None) in demo_names]:
        del session.files[file_id]
    if len(session.files) + len(pattern.inputs) > settings.max_files:
        raise AppError(
            409,
            "TOO_MANY_FILES_FOR_DEMO",
            f"デモには{len(pattern.inputs)}つのファイルを使いますが、読み込めるファイルは{settings.max_files}つまでです。",
            how_to_fix="「データを読み込む」の画面で、使わないファイルを削除してから、もう一度デモを始めてください。",
        )

    bindings = []
    for i in pattern.inputs:
        uploaded = accept_upload(session, (DATA_DIR / i.filename).read_bytes(), i.filename, settings)
        bindings.append(BindingOut(input_id=i.input_id, file_id=uploaded.file_id, sheet=i.sheet, header_row=1))
    return StartResponse(
        demo_id=demo.demo_id,
        title=demo.title,
        pattern=req.pattern,
        pattern_label=pattern.label,
        description=pattern.description,
        guide=pattern.guide,
        flow=demo.flow(),
        bindings=bindings,
        run_parameters=dict(pattern.run_parameters),
    )
