# FlowCraft AI の公開用コンテナ（Hugging Face Spaces の Docker で動かす想定）。
# 1段目で画面を組み立て、2段目で FastAPI が窓口（/api）と画面の両方を配信する1コンテナ構成（docs/architecture.md）。
# 秘密の値（APIキー・AI使用パスワードのハッシュ）はここに書かない。公開先の「秘密の設定」に置き、環境変数として渡す。

# ---- 1段目：画面を組み立てる（型チェック込み） ----
FROM node:24-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- 2段目：サーバー ----
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1 \
    FRONTEND_DIST=/app/static
# Hugging Face Spaces はユーザー番号1000で動かす。管理者の権限では動かさない
RUN useradd -m -u 1000 user
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY --from=web /web/dist ./static
USER user
EXPOSE 7860
# --proxy-headers：公開先の中継サーバーが付ける「本当の送り元」を使う（AI使用パスワードの失敗回数を、利用者ごとに数えるため）
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860", "--proxy-headers", "--forwarded-allow-ips", "*"]
