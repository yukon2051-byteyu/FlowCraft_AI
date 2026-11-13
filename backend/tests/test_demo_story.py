"""デモ全面改善：STEP 1・2 の説明が、実際の作業手順と食い違わないこと。

- 改善後の処理手順・改善例の対応先（処理ステップ n…・完了基準 c…）が、作業手順に実在する
- 作業手順の処理ステップと完了基準は、すべて改善後の処理手順のどこかで説明している（説明していない処理がない）
- 処理手順の順番は、作業手順の処理の順番と矛盾しない
- 開始の API が説明を返す
"""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.demos.catalog import DEMOS
from app.main import create_app


@pytest.mark.parametrize("demo_id", list(DEMOS))
def test_説明の対応先は作業手順に実在し_すべての処理と基準を説明している(demo_id):
    demo = DEMOS[demo_id]
    st = demo.story
    assert st is not None
    flow = demo.flow()
    nodes = [n["node_id"] for n in flow["nodes"]]
    crits = [c["criterion_id"] for c in flow["completion_criteria"]["items"]]
    known = set(nodes) | set(crits)
    for x in [*st.steps, *st.improvements]:
        assert x.refs and set(x.refs) <= known, x
    covered = {r for step in st.steps for r in step.refs}
    assert covered == known
    # 処理の順番：各段の最初の処理ステップが、作業手順の順に並ぶ
    firsts = [min(nodes.index(r) for r in step.refs if r in nodes) for step in st.steps if any(r in nodes for r in step.refs)]
    assert firsts == sorted(firsts)
    assert 3 <= len(st.current_work) <= 7 and 2 <= len(st.issues) <= 5 and 2 <= len(st.improvements) <= 5


def test_開始のAPIは説明を返す():
    settings = Settings(_env_file=None)
    app = create_app(settings)
    app.dependency_overrides[get_settings] = lambda: settings
    with TestClient(app) as c:
        h = {"X-Session-Id": c.post("/api/session").json()["session_id"]}
        body = c.post("/api/demos/product_match/start", headers=h, json={"pattern": "ng"}).json()
        assert body["story"]["business_name"] == "売上データの商品マスタ照合"
        assert body["story"]["steps"][-1] == {"label": "Excelに出力する", "refs": ["n5"]}
