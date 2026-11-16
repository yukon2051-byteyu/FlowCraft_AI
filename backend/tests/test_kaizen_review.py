"""工程の一覧（WorkReview）から、決まった規則で改善候補を出す（AI業務改善診断で、事実の根拠として使う部品）。

2026-11-16：利用者が工程の表を入力する画面と、そのAPIは廃止した（AIを使わない業務改善診断の廃止）。規則の部品は残す。

- 規則はデモと同じもの（diagnose_work）を使う。見るのは入力した事実（作業の種類・書き写し元・くり返しの回数・必ず残す工程）だけ
- 部署のExcelは使わないので、列名の標準化（KD-3）は出さない
すべて架空の業務。
"""

import copy

import pytest

from app.kaizen.diagnose import diagnose_review
from app.kaizen.models import WorkReview

# 架空の業務：各支店の経費精算Excelを受け取り、確認し、集計して、2つの資料へ書き写す
BASE = {
    "context": {"purpose": "支店の経費を毎月まとめる", "pain_points": ["同じ数値を何度も書き写している"], "must_keep": ["経理部長の承認"]},
    "steps": [
        {"step_id": "s1", "name": "支店の経費Excelを受け取る", "action": "receive", "repeat_count": 4},
        {"step_id": "s2", "name": "金額と科目を確認する", "action": "inspect", "repeat_count": 4},
        {"step_id": "s3", "name": "科目ごとに合計する", "action": "aggregate", "minutes": 30},
        {"step_id": "s4", "name": "経費一覧表に書き写す", "action": "copy", "transcribes_from": "s3", "deliverable": "経費一覧表"},
        {"step_id": "s5", "name": "役員会資料に書き写す", "action": "transcribe", "transcribes_from": "s3", "deliverable": "役員会報告資料"},
        {"step_id": "s6", "name": "経理部長が承認する", "action": "share", "must_keep": True},
    ],
}


def review(**patch) -> WorkReview:
    data = copy.deepcopy(BASE)
    data.update(patch)
    return WorkReview.model_validate(data)


def by_rule(d, rule):
    return [c for c in d.candidates if c.rule_id == rule]


def test_入力した事実から_廃止_簡素化_自動化の候補が出る_標準化は出ない():
    d = diagnose_review(review())
    assert [c.rule_id for c in d.candidates] == ["KD-1", "KD-2", "KD-4"]
    assert d.ai_used is False


def test_廃止_同じ結果を2つの成果物へ書き写すと_2つ目の書き写しが候補になる():
    [c] = by_rule(diagnose_review(review()), "KD-1")
    assert c.target_steps == ["s5"]
    assert c.title == "役員会資料への重複転記を廃止"
    assert c.confirm_question is not None  # 廃止は必ず確認してから
    assert any("同じ数値を何度も書き写している" in e.text for e in c.evidence)


def test_廃止_書き写しが1つなら出ない_資料でない成果物の名前はかぎかっこで示す():
    data = copy.deepcopy(BASE)
    data["steps"][4]["transcribes_from"] = None
    assert by_rule(diagnose_review(WorkReview.model_validate(data)), "KD-1") == []
    data = copy.deepcopy(BASE)
    data["steps"][4]["deliverable"] = "週報"
    assert by_rule(diagnose_review(WorkReview.model_validate(data)), "KD-1")[0].title == "「週報」への重複転記を廃止"


def test_簡素化_くり返しの回数を根拠に示し_1回なら出ない():
    [c] = by_rule(diagnose_review(review()), "KD-2")
    assert c.target_steps == ["s1", "s2"]
    assert "4部署" in c.detail
    assert c.depends_on == []  # 列名の標準化は調べないので、前提にしない
    data = copy.deepcopy(BASE)
    for s in data["steps"]:
        s["repeat_count"] = 1
    assert by_rule(diagnose_review(WorkReview.model_validate(data)), "KD-2") == []


def test_必ず残す工程は_廃止_簡素化の対象にせず_理由を示す():
    data = copy.deepcopy(BASE)
    data["steps"][4]["must_keep"] = True
    d = diagnose_review(WorkReview.model_validate(data))
    assert by_rule(d, "KD-1") == []
    assert [k.step_id for k in d.kept] == ["s5", "s6"]
    assert "経理部長の承認" in d.kept[0].reason
    # 業務の情報に「必ず残すこと」を書いていなくても、工程の指定だけで残す
    data["context"]["must_keep"] = []
    assert diagnose_review(WorkReview.model_validate(data)).kept[0].reason == "「必ず残す」工程として指定されているため"


def test_自動化_処理エンジンで行える手作業と_未対応の工程を分けて示す():
    [c] = by_rule(diagnose_review(review()), "KD-4")
    assert c.target_steps == ["s1", "s2", "s3", "s4"]
    assert c.unsupported_steps == ["s5", "s6"]
    # すでに自動の工程しかなければ、自動化の候補は出ない
    data = copy.deepcopy(BASE)
    for s in data["steps"]:
        s["mode"] = "auto"
    assert by_rule(diagnose_review(WorkReview.model_validate(data)), "KD-4") == []


def test_工程名の文字では判定しない_名前を変えても同じ候補になる():
    data = copy.deepcopy(BASE)
    for i, s in enumerate(data["steps"]):
        s["name"] = f"作業{i + 1}"
    renamed = diagnose_review(WorkReview.model_validate(data))
    assert [(c.rule_id, c.target_steps) for c in renamed.candidates] == [(c.rule_id, c.target_steps) for c in diagnose_review(review()).candidates]


@pytest.mark.parametrize(
    "edit, message",
    [
        (lambda d: d["steps"][3].update(transcribes_from="s5"), "「経費一覧表に書き写す」の書き写し元は、それより前の工程を選んでください"),
        (lambda d: d["steps"][1].update(step_id="s1"), "工程の識別（step_id）が重複しています"),
    ],
)
def test_入力の誤りは_どこが誤っているかを示して拒否する(edit, message):
    data = copy.deepcopy(BASE)
    edit(data)
    with pytest.raises(ValueError, match=message):
        WorkReview.model_validate(data)
