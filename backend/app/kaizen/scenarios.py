"""業務改善診断の業務シナリオ（デモ①）を読み込む。部署のExcelの列名は、実際のファイルから読む（書き写さない）。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from functools import lru_cache
from pathlib import Path

import openpyxl

from app.demos.catalog import DATA_DIR
from app.kaizen.models import Scenario

SCENARIO_DIR = Path(__file__).parent / "scenarios"


@lru_cache
def load_scenario(scenario_id: str) -> Scenario | None:
    path = SCENARIO_DIR / f"{scenario_id}.json"
    if not scenario_id.isidentifier() or not path.is_file():
        return None
    return Scenario.model_validate_json(path.read_text(encoding="utf-8"))


@dataclass(frozen=True)
class FileFacts:
    """部署のExcelから実際に読み取った事実（列名と件数）。"""

    department: str
    filename: str
    sheet: str
    columns: list[str]
    rows: int
    kinds: list[str]  # 列ごとの形式（number／date／text／empty）。空欄でない値から決める。混在は mixed


def _kind(values: list[object]) -> str:
    kinds = set()
    for v in values:
        if v is None or (isinstance(v, str) and not v.strip()):
            continue
        if isinstance(v, (datetime, date)):
            kinds.add("date")
        elif isinstance(v, (int, float)) and not isinstance(v, bool):
            kinds.add("number")
        else:
            kinds.add("text")
    if not kinds:
        return "empty"
    return kinds.pop() if len(kinds) == 1 else "mixed"


def read_file_facts(scenario: Scenario, data_dir: Path = DATA_DIR) -> list[FileFacts]:
    out = []
    for f in scenario.department_files:
        wb = openpyxl.load_workbook(data_dir / f.filename, read_only=True)
        try:
            rows = list(wb[f.sheet].iter_rows(values_only=True))
        finally:
            wb.close()
        header = [str(v) for v in rows[0] if v is not None] if rows else []
        body = [r for r in rows[1:] if any(v is not None for v in r)]
        kinds = [_kind([r[i] if i < len(r) else None for r in body]) for i in range(len(header))]
        out.append(FileFacts(f.department, f.filename, f.sheet, header, len(body), kinds))
    return out
