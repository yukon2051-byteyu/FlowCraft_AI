"""アプリ全体の設定。

値は環境変数（または backend/.env ファイル）で上書きできる。
例：MAX_FILES=10 を設定すると、アップロード上限が10ファイルになる。
"""

from functools import lru_cache

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

    # ----- ファイル制限 -----
    max_files: int = Field(default=5, ge=1)
    max_file_size_mb: int = Field(default=10, ge=1)
    max_total_rows: int = Field(default=100_000, ge=1)
    max_intermediate_rows: int = Field(default=500_000, ge=1)

    # ----- セッション・実行 -----
    session_ttl_minutes: int = Field(default=60, ge=1)
    session_purge_interval_seconds: int = Field(default=60, ge=1)  # 期限切れを掃除する間隔
    max_sessions: int = Field(default=200, ge=1)  # 同時に保持するセッション数の上限（メモリ保護）
    run_timeout_seconds: int = Field(default=60, ge=1)

    @property
    def ai_enabled(self) -> bool:
        """APIキーが設定されていれば実際のAIを使う。なければ固定応答モード。"""
        return self.anthropic_api_key is not None and self.anthropic_api_key.get_secret_value() != ""


@lru_cache
def get_settings() -> Settings:
    """設定を1回だけ読み込み、以降は同じものを返す。"""
    return Settings()
