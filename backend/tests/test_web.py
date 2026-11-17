"""公開環境：組み立て済みの画面をサーバーから配信する（app/web.py）。架空の画面ファイルを一時フォルダに作って確かめる。"""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def site(tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>架空の画面</title>", encoding="utf-8")
    (dist / "assets" / "app-abc123.js").write_text("console.log('架空')", encoding="utf-8")
    (dist / "favicon.svg").write_text("<svg></svg>", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("配信フォルダの外の秘密", encoding="utf-8")
    client = TestClient(create_app(Settings(_env_file=None, frontend_dist=str(dist))))
    return client


def test_画面のURLは_どれも画面の入り口を返し_保存させない(site):
    for url in ("/", "/build", "/build?start=work", "/kaizen-demo", "/存在しない画面"):
        res = site.get(url)
        assert res.status_code == 200, url
        assert "架空の画面" in res.text
        assert res.headers["cache-control"] == "no-cache"


def test_実在するファイルはそのまま返し_assetsは長く保存させる(site):
    js = site.get("/assets/app-abc123.js")
    assert js.status_code == 200 and "架空" in js.text
    assert "javascript" in js.headers["content-type"]
    assert "immutable" in js.headers["cache-control"]
    icon = site.get("/favicon.svg")
    assert icon.status_code == 200 and "svg" in icon.headers["content-type"]
    assert icon.headers["X-Content-Type-Options"] == "nosniff"  # 安全設定も付く


def test_窓口は画面より優先し_ない窓口は画面ではなくエラーを返す(site):
    assert site.get("/api/health").json()["status"] == "ok"
    for url in ("/api/存在しない", "/api"):
        res = site.get(url)
        assert res.status_code == 404, url
        assert res.json()["error"]["code"] in ("NOT_FOUND", "HTTP_404")


@pytest.mark.parametrize("url", ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/..%2f..%2fsecret.txt", "/..%5csecret.txt"])
def test_配信フォルダの外のファイルは返さない(site, url):
    res = site.get(url)
    assert "配信フォルダの外の秘密" not in res.text


def test_設定しなければ画面は配信しない():
    client = TestClient(create_app(Settings(_env_file=None)))
    assert client.get("/").status_code == 404
    assert client.get("/api/health").status_code == 200


def test_画面の入り口がないフォルダを指定したら_起動時に止める(tmp_path):
    with pytest.raises(RuntimeError, match="index.html"):
        create_app(Settings(_env_file=None, frontend_dist=str(tmp_path)))
