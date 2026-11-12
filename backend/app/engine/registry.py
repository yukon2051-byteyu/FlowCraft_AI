"""実行してよいノードの一覧（ホワイトリスト）。

ここに登録された node_type だけが実行される。登録されていない種類は、
フローJSONの検証を通っていても実行しない（二重の安全装置）。
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from app.engine.result import EngineIssue, OutputSheet
from app.engine.table import Table


@dataclass
class NodeContext:
    """ノードの実行に必要な周辺情報。"""

    bindings: dict[str, Any]  # input_id → Binding
    files: dict[str, Any]  # file_id → UploadedFile
    input_definitions: dict[str, Any]  # input_id → InputDefinition
    validation_rules: Any
    max_rows: int


@dataclass
class NodeOutput:
    table: Table | None
    issues: list[EngineIssue] = field(default_factory=list)
    sheets: list[OutputSheet] = field(default_factory=list)  # 出力ノードのみ


Handler = Callable[[Any, list[Table], NodeContext], NodeOutput]

_REGISTRY: dict[str, Handler] = {}


def register(node_type: str) -> Callable[[Handler], Handler]:
    def deco(fn: Handler) -> Handler:
        if node_type in _REGISTRY:
            raise RuntimeError(f"{node_type} は登録済みです")
        _REGISTRY[node_type] = fn
        return fn

    return deco


def _ensure_loaded() -> None:
    """ノードの実装を読み込み、登録を済ませる。

    どのモジュールから先に使われても（runner を経由しなくても）、
    ホワイトリストが空のまま参照されることがないようにする。
    """
    import app.engine.nodes  # noqa: F401  読み込むと各ノードが register される


def get_handler(node_type: str) -> Handler | None:
    _ensure_loaded()
    return _REGISTRY.get(node_type)


def registered_types() -> list[str]:
    _ensure_loaded()
    return sorted(_REGISTRY)
