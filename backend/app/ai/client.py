"""AIの呼び出しと、出力の形の検証。

- 返答は決めた形（pydantic のモデル）で受け取る。形が合わない・途中で切れた・回答を断られたときは、使わずにエラーにする
- 固定応答モード（ai_status == "fixed"）：AIを呼ばず、機能ごとに登録した固定の返答を同じ検証にかける（費用なし。テスト・開発用）
- 実際のAI（ai_status == "live"）：Anthropic 公式 SDK の messages.parse（構造化出力）を使う。SDK は使うときだけ読み込む
APIキーはサーバーの設定だけが持つ（画面には渡さない）。
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, ValidationError

from app.config import Settings
from app.errors import AppError

T = TypeVar("T", bound=BaseModel)

# 機能ごとの固定の返答（固定応答モードで使う）。user の文を受け取り、返答の dict を返す
FIXED_RESPONSES: dict[str, Callable[[str], dict[str, Any]]] = {}


def fixed_response(feature: str) -> Callable[[Callable[[str], dict[str, Any]]], Callable[[str], dict[str, Any]]]:
    def register(fn: Callable[[str], dict[str, Any]]) -> Callable[[str], dict[str, Any]]:
        FIXED_RESPONSES[feature] = fn
        return fn

    return register


@dataclass
class AiResult(Generic[T]):
    data: T
    input_tokens: int
    output_tokens: int


class AiOutputError(Exception):
    """AIは応答したが、使えない（形が違う・途中で切れた・回答を断った）。費用はかかっているので記録する"""

    def __init__(self, error: AppError, input_tokens: int = 0, output_tokens: int = 0):
        super().__init__(error.message)
        self.error = error
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens


def bad_output(cause: str) -> AppError:
    return AppError(
        502,
        "AI_BAD_OUTPUT",
        "AIの応答を確かめられませんでした。",
        cause=cause,
        how_to_fix="もう一度お試しください。続く場合は、AIを使わずに手順を作れます。",
    )


def call_failed(cause: str) -> AppError:
    return AppError(
        503,
        "AI_CALL_FAILED",
        "AIを呼び出せませんでした。",
        cause=cause,
        how_to_fix="時間をおいて、もう一度お試しください。AIを使わない機能は、そのまま使えます。",
    )


def _make_client(settings: Settings) -> Any:
    """実際のAIの呼び出し口（テストでは差し替える）"""
    import anthropic  # 使うときだけ読み込む（固定応答モード・テストでは不要）

    key = settings.anthropic_api_key.get_secret_value() if settings.anthropic_api_key else None
    return anthropic.Anthropic(api_key=key, timeout=settings.ai_timeout_seconds, max_retries=settings.ai_max_retries)


make_client: Callable[[Settings], Any] = _make_client


def call_structured(settings: Settings, feature: str, system: str, user: str, output_model: type[T], max_tokens: int) -> AiResult[T]:
    if settings.ai_status == "fixed":
        responder = FIXED_RESPONSES.get(feature)
        if responder is None:
            raise AiOutputError(bad_output(f"固定応答モードに「{feature}」の返答が登録されていません。"))
        raw = responder(user)
        try:
            data = output_model.model_validate(raw)
        except ValidationError as e:
            raise AiOutputError(bad_output(f"返答の形が決めた形と違います（{e.error_count()}件）。")) from None
        return AiResult(data, input_tokens=len(system) + len(user), output_tokens=len(json.dumps(raw, ensure_ascii=False)))

    import anthropic

    client = make_client(settings)
    try:
        resp = client.messages.parse(
            model=settings.claude_model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
            output_format=output_model,
        )
    except anthropic.APIConnectionError:
        raise call_failed("AIのサーバーにつながりませんでした。") from None
    except anthropic.RateLimitError:
        raise call_failed("AIのサーバーが混み合っています。") from None
    except anthropic.APIStatusError as e:
        raise call_failed(f"AIのサーバーがエラーを返しました（{e.status_code}）。") from None
    except ValidationError:
        raise AiOutputError(bad_output("返答の形が決めた形と違います。")) from None

    usage = getattr(resp, "usage", None)
    tin = int(getattr(usage, "input_tokens", 0) or 0)
    tout = int(getattr(usage, "output_tokens", 0) or 0)
    if resp.stop_reason == "refusal":
        raise AiOutputError(bad_output("AIがこの依頼への回答を断りました。"), tin, tout)
    if resp.stop_reason == "max_tokens":
        raise AiOutputError(bad_output("返答が長すぎて、途中で切れました。"), tin, tout)
    parsed = resp.parsed_output
    if parsed is None:
        raise AiOutputError(bad_output("返答から、決めた形の内容を取り出せませんでした。"), tin, tout)
    return AiResult(parsed, tin, tout)
