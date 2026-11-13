"""品質MVPの共通基盤（docs/quality-mvp-design.md）。

手動実行（画面）・クラウドWorker・Windows Worker が、同じ関数で
「実行の記録を作る」「正式な出力をしてよいかを決める」「前回と比べる」を行う。
保存先（ブラウザ・SQLite・PostgreSQL）には依存しない。
"""
