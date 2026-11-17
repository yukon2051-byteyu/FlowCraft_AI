"""アプリ全体の設定。

値は環境変数（または backend/.env ファイル）で上書きできる。
例：MAX_FILES=10 を設定すると、アップロード上限が10ファイルになる。
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # ----- Claude API -----
    # SecretStr にすると、ログや画面に出力しても「**********」と表示され、キーが漏れにくい
    anthropic_api_key: SecretStr | None = None
    claude_model: str = "claude-opus-5-5"
    ai_timeout_seconds: float = Field(default=60, gt=0)
    ai_max_retries: int = Field(default=2, ge=0, le=5)
    ai_monthly_budget_usd: float = Field(default=10, ge=0)
    # AIの動かし方（docs/ai-auth-design.md）
    #   auto ：APIキーとAI使用パスワードの両方があれば実際のAI（live）。どちらかがなければ使わない（off）
    #   off  ：使わない（AIの操作は「利用できません」と返す）
    #   fixed：固定応答（AIを呼ばない・費用なし）。テストと開発のときだけ明示的に選ぶ
    ai_mode: Literal["auto", "off", "fixed"] = "auto"
    # AI使用パスワードのハッシュ（python -m app.ai.password で作る）。パスワードそのものは置かない
    ai_password_hash: SecretStr | None = None
    ai_calls_per_hour: int = Field(default=20, ge=1)  # 1つのセッションで1時間に呼べる回数
    ai_auth_idle_minutes: int = Field(default=60, ge=1)  # 最後にAIを使ってから、この時間で認証が切れる
    ai_auth_max_hours: int = Field(default=8, ge=1)  # 認証の最長の期限

    # ----- ファイル制限 -----
    max_files: int = Field(default=5, ge=1)
    max_file_size_mb: int = Field(default=10, ge=1)
    # ファイル以外の送信（作業手順・実行の履歴などのJSON）の上限。正しい使い方では数百KB程度（巨大な送信でメモリを使わせない）
    max_request_mb: int = Field(default=5, ge=1)
    max_total_rows: int = Field(default=100_000, ge=1)
    max_intermediate_rows: int = Field(default=500_000, ge=1)
    max_columns: int = Field(default=500, ge=1)
    max_uncompressed_mb: int = Field(default=100, ge=1)  # xlsx展開後の上限（ZIP爆弾対策）

    # ----- セッション・実行 -----
    session_ttl_minutes: int = Field(default=60, ge=1)
    session_purge_interval_seconds: int = Field(default=60, ge=1)  # 期限切れを掃除する間隔
    max_sessions: int = Field(default=200, ge=1)  # 同時に保持するセッション数の上限（メモリ保護）
    run_timeout_seconds: int = Field(default=60, ge=1)

    @property
    def ai_status(self) -> Literal["off", "fixed", "live"]:
        """AIの状態。パスワードがなければ認証できないので、どのモードでも使わない（off）。

        未完成・未設定のAIを、使えるかのように見せない（APIキーがないときに固定応答へ黙って切り替えない）。
        """
        has_password = self.ai_password_hash is not None and self.ai_password_hash.get_secret_value() != ""
        has_key = self.anthropic_api_key is not None and self.anthropic_api_key.get_secret_value() != ""
        if self.ai_mode == "off" or not has_password:
            return "off"
        if self.ai_mode == "fixed":
            return "fixed"
        return "live" if has_key else "off"


@lru_cache
def get_settings() -> Settings:
    """設定を1回だけ読み込み、以降は同じものを返す。"""
    return Settings()
