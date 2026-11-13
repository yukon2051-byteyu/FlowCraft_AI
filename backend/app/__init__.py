"""FlowCraft AI バックエンド。"""

# 処理エンジンのバージョン。フローJSONと処理履歴に記録し、再現性の確認に使う。
ENGINE_VERSION = "0.1.0"

# 画面が使うAPIの版。画面が前提とするAPI（窓口）を追加・変更したら +1 する。
# 画面（frontend/src/api/serverVersion.ts の EXPECTED_API_REVISION）は起動時に /api/health で確かめ、
# サーバーが古い版のまま動いているとき（画面とサーバーの食い違い）に、原因と直し方を表示する。
API_REVISION = 3
