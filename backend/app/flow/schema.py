"""フローJSONのスキーマ（形の決まり）。詳細仕様は docs/flow-schema.md。

ここで定義した Pydantic モデルが「正本」になる。
- AIの出力、画面からの保存データ、読み込んだJSONは、必ずこのモデルを通して検証する。
- 定義にない項目（extra）は拒否する。AIが勝手な項目を足しても通さないため。
- 処理の種類（node_type）はここに列挙したものだけ。任意コードを表す種類は存在しない。

このファイルが扱うのは「1つ1つの項目の形」まで。
ノード同士の参照関係（上にあるデータしか使えない等）は validate.py で検証する。
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Annotated, Any, Literal, Union
from uuid import UUID

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, model_validator

SCHEMA_VERSION = "1.0"
SUPPORTED_SCHEMA_VERSIONS = ("1.0",)

MAX_NODES = 100
MAX_EXPRESSION_DEPTH = 5
MAX_CONDITION_DEPTH = 3

# ---------------------------------------------------------------------------
# 共通の型
# ---------------------------------------------------------------------------

# ノードIDや参照名：英数字と_のみ（AIや利用者が記号・空白・パスを紛れ込ませないように制限）
RefName = Annotated[str, Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")]
# 列名：Excelの列名なので日本語・空白も許可。ただし空文字と極端に長い名前は拒否
ColumnName = Annotated[str, Field(min_length=1, max_length=255)]
Label = Annotated[str, Field(min_length=1, max_length=100)]


def _to_canonical_str(v: Any) -> Any:
    """値を「文字列」にそろえる。

    JSONの数値は読込時に小数誤差が入りうるため、フロー内では値を文字列で保持し、
    実行時に列の型（整数・小数・日付など）に合わせて変換する。
    例：1000 → "1000"、0.1 → "0.1"、True → "true"
    """
    if v is None or isinstance(v, str):
        return v
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return repr(v)
    if isinstance(v, Decimal):
        return format(v, "f")
    return v  # それ以外の型は str の検証でエラーにする


ScalarValue = Annotated[str | None, BeforeValidator(_to_canonical_str)]

ColumnType = Literal["string", "integer", "decimal", "date", "boolean"]
# 丸め方式（ノードごとに選択。設計書 §8・確認事項Q2）
Rounding = Literal["half_up", "down", "up", "half_even"]
ConfirmationStatus = Literal["unset", "ai_proposed", "pending", "confirmed"]


class StrictModel(BaseModel):
    """定義にない項目を拒否する共通の親クラス。"""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)


# ---------------------------------------------------------------------------
# 入力定義（どんなファイルが必要か。データの中身は持たない）
# ---------------------------------------------------------------------------


class ColumnSchema(StrictModel):
    name: ColumnName
    type: ColumnType
    scale: Annotated[int, Field(ge=0, le=10)] | None = None  # decimal の小数桁数
    date_format: str | None = None  # 例 "%Y/%m/%d"。省略時は既定の書式で解釈
    required: bool = True


class InputDefinition(StrictModel):
    input_id: RefName
    label: Label
    file_kind: Literal["xlsx", "csv"]
    sheet_hint: str | None = None
    header_row: Annotated[int, Field(ge=1, le=100)] = 1
    columns: Annotated[list[ColumnSchema], Field(min_length=1)]

    @model_validator(mode="after")
    def _unique_columns(self) -> InputDefinition:
        names = [c.name for c in self.columns]
        dup = sorted({n for n in names if names.count(n) > 1})
        if dup:
            raise ValueError(f"列名が重複しています: {', '.join(dup)}")
        return self


# ---------------------------------------------------------------------------
# 抽出条件（行の抽出ノード）：AND/OR を木構造で表す
# ---------------------------------------------------------------------------

FilterOperator = Literal[
    "eq",  # 等しい
    "ne",  # 等しくない
    "gt",  # より大きい
    "ge",  # 以上
    "lt",  # より小さい
    "le",  # 以下
    "contains",  # 含む
    "not_contains",  # 含まない
    "is_empty",  # 空欄
    "is_not_empty",  # 空欄ではない
]
_NO_VALUE_OPERATORS = {"is_empty", "is_not_empty"}


class Condition(StrictModel):
    kind: Literal["condition"] = "condition"
    column: ColumnName
    operator: FilterOperator
    value: ScalarValue = None

    @model_validator(mode="after")
    def _value_required(self) -> Condition:
        if self.operator in _NO_VALUE_OPERATORS and self.value is not None:
            raise ValueError(f"演算子 {self.operator} では value を指定できません")
        if self.operator not in _NO_VALUE_OPERATORS and self.value is None:
            raise ValueError(f"演算子 {self.operator} には value が必要です")
        return self


class ConditionGroup(StrictModel):
    kind: Literal["group"] = "group"
    logic: Literal["and", "or"]
    conditions: Annotated[list[ConditionNode], Field(min_length=1, max_length=20)]


ConditionNode = Annotated[Union[Condition, ConditionGroup], Field(discriminator="kind")]


def _condition_depth(node: Condition | ConditionGroup) -> int:
    if isinstance(node, Condition):
        return 1
    return 1 + max(_condition_depth(c) for c in node.conditions)


# ---------------------------------------------------------------------------
# 計算式（計算ノード）：eval を使わず、許可した演算だけを木構造で表す
# ---------------------------------------------------------------------------


class ColumnOperand(StrictModel):
    kind: Literal["column"] = "column"
    column: ColumnName


class ConstantOperand(StrictModel):
    kind: Literal["constant"] = "constant"
    value: ScalarValue

    @model_validator(mode="after")
    def _numeric(self) -> ConstantOperand:
        try:
            d = Decimal(self.value or "")
        except InvalidOperation:
            raise ValueError(f"定数は数値で指定してください: {self.value!r}") from None
        if not d.is_finite():
            raise ValueError(f"定数に使えない値です: {self.value!r}")
        return self


class BinaryOperation(StrictModel):
    kind: Literal["operation"] = "operation"
    # ratio_percent：left ÷ right × 100（比率をパーセントで）
    op: Literal["add", "subtract", "multiply", "divide", "ratio_percent"]
    left: Expression
    right: Expression


Expression = Annotated[Union[ColumnOperand, ConstantOperand, BinaryOperation], Field(discriminator="kind")]


def _expression_depth(node: ColumnOperand | ConstantOperand | BinaryOperation) -> int:
    if isinstance(node, BinaryOperation):
        return 1 + max(_expression_depth(node.left), _expression_depth(node.right))
    return 1


# ---------------------------------------------------------------------------
# 各ノードのパラメータ（12カテゴリ。設計書 §6）
# ---------------------------------------------------------------------------


class LoadParams(StrictModel):
    input_id: RefName


class FilterParams(StrictModel):
    condition: ConditionNode

    @model_validator(mode="after")
    def _depth(self) -> FilterParams:
        if _condition_depth(self.condition) > MAX_CONDITION_DEPTH + 1:
            raise ValueError(f"条件の入れ子は{MAX_CONDITION_DEPTH}段までです")
        return self


class SortKey(StrictModel):
    column: ColumnName
    ascending: bool = True


class SortParams(StrictModel):
    keys: Annotated[list[SortKey], Field(min_length=1, max_length=10)]


class SelectColumnsParams(StrictModel):
    """残す列を指定する（指定順に並べる）。"""

    columns: Annotated[list[ColumnName], Field(min_length=1)]


class Rename(StrictModel):
    source: ColumnName
    target: ColumnName


class RenameColumnsParams(StrictModel):
    renames: Annotated[list[Rename], Field(min_length=1)]


class DropColumnsParams(StrictModel):
    columns: Annotated[list[ColumnName], Field(min_length=1)]


class AddConstantParams(StrictModel):
    column: ColumnName
    value: ScalarValue
    value_type: ColumnType = "string"


class CastSpec(StrictModel):
    column: ColumnName
    to: ColumnType
    scale: Annotated[int, Field(ge=0, le=10)] | None = None
    date_format: str | None = None
    rounding: Rounding = "half_up"


class CastParams(StrictModel):
    casts: Annotated[list[CastSpec], Field(min_length=1)]
    # 変換できない値があったとき：error＝停止 / warn＝空欄にして件数を警告
    on_failure: Literal["error", "warn"] = "error"


class DuplicatesParams(StrictModel):
    key_columns: Annotated[list[ColumnName], Field(min_length=1)]
    mode: Literal["detect", "remove"]  # detect はデータを変えない
    keep: Literal["first", "last"] = "first"


class MissingParams(StrictModel):
    columns: Annotated[list[ColumnName], Field(min_length=1)]
    mode: Literal["detect", "fill", "drop_rows"]  # detect はデータを変えない
    fill_value: ScalarValue = None

    @model_validator(mode="after")
    def _fill_value(self) -> MissingParams:
        if self.mode == "fill" and self.fill_value is None:
            raise ValueError("補完（fill）には fill_value が必要です")
        if self.mode != "fill" and self.fill_value is not None:
            raise ValueError("fill_value は補完（fill）のときだけ指定できます")
        return self


class JoinKey(StrictModel):
    left: ColumnName
    right: ColumnName


class JoinParams(StrictModel):
    """結合。左＝input_references[0]、右＝input_references[1]。"""

    keys: Annotated[list[JoinKey], Field(min_length=1, max_length=5)]
    how: Literal["inner", "left", "right", "outer"]
    expected_relationship: Literal["one_to_one", "one_to_many", "many_to_one", "many_to_many"]
    unmatched_policy: Literal["warn", "error"] = "warn"
    # キーの前後空白を除いて照合するか（既定はしない＝データを黙って変えない）
    key_normalization: Literal["none", "trim"] = "none"
    # 結合前後で合計を比較する金額列（左側の列名）
    check_amount_columns: list[ColumnName] = Field(default_factory=list)
    # 左右で同じ列名があった場合に右側の列名へ付ける接尾辞
    right_suffix: Annotated[str, Field(min_length=1, max_length=20)] = "_右"


class ConcatSource(StrictModel):
    reference: RefName
    label: Label | None = None  # source_column に入れる値（例：「東京」）
    renames: list[Rename] = Field(default_factory=list)  # 列名の対応付け


class ConcatParams(StrictModel):
    """縦方向の連結。sources は input_references と同じ順序で並べる。"""

    sources: Annotated[list[ConcatSource], Field(min_length=2, max_length=10)]
    # 一部の入力に列が足りないとき：error＝停止 / allow＝空欄のまま連結し件数を警告
    missing_columns: Literal["error", "allow"] = "error"
    source_column: ColumnName | None = None  # どの入力の行かを記録する列名（例：「支店」）


AggFunction = Literal["sum", "mean", "max", "min", "count", "nunique"]


class Aggregation(StrictModel):
    function: AggFunction
    column: ColumnName | None = None  # count のときだけ省略可（行数を数える）
    output_column: ColumnName
    scale: Annotated[int, Field(ge=0, le=10)] | None = None
    rounding: Rounding = "half_up"

    @model_validator(mode="after")
    def _column(self) -> Aggregation:
        if self.function != "count" and self.column is None:
            raise ValueError(f"集計方法 {self.function} には column が必要です")
        return self


class AggregateParams(StrictModel):
    group_by: Annotated[list[ColumnName], Field(max_length=10)]  # 空なら全体で1行に集計
    aggregations: Annotated[list[Aggregation], Field(min_length=1, max_length=20)]


class CalculateParams(StrictModel):
    output_column: ColumnName
    expression: Expression
    scale: Annotated[int, Field(ge=0, le=10)] | None = None
    rounding: Rounding = "half_up"
    on_zero_division: Literal["warn", "error"] = "warn"

    @model_validator(mode="after")
    def _depth(self) -> CalculateParams:
        if _expression_depth(self.expression) > MAX_EXPRESSION_DEPTH + 1:
            raise ValueError(f"計算式の入れ子は{MAX_EXPRESSION_DEPTH}段までです")
        return self


_FORBIDDEN_SHEET_CHARS = set('[]:*?/\\')


class OutputSheet(StrictModel):
    reference: RefName
    sheet_name: Annotated[str, Field(min_length=1, max_length=31)]  # Excelのシート名上限は31文字

    @model_validator(mode="after")
    def _sheet_chars(self) -> OutputSheet:
        bad = _FORBIDDEN_SHEET_CHARS & set(self.sheet_name)
        if bad:
            raise ValueError(f"シート名に使えない文字が含まれています: {''.join(sorted(bad))}")
        return self


class OutputParams(StrictModel):
    """Excel出力。sheets は input_references と同じ順序で並べる。"""

    sheets: Annotated[list[OutputSheet], Field(min_length=1, max_length=10)]

    @model_validator(mode="after")
    def _unique_names(self) -> OutputParams:
        names = [s.sheet_name for s in self.sheets]
        if len(names) != len(set(names)):
            raise ValueError("シート名が重複しています")
        return self


# ---------------------------------------------------------------------------
# ノード
# ---------------------------------------------------------------------------


class OpenQuestion(StrictModel):
    """AIが利用者に確認したいこと。未回答の質問があるノードは実行できない。"""

    param: str
    question: Annotated[str, Field(min_length=1, max_length=500)]


# 入力参照の数の決まり（node_type → (最小, 最大)）。None は上限なし
_INPUT_COUNT: dict[str, tuple[int, int | None]] = {
    "load": (0, 0),
    "join": (2, 2),
    "concat": (2, 10),
    "output": (1, 10),
}
_DEFAULT_INPUT_COUNT = (1, 1)


class NodeBase(StrictModel):
    node_id: RefName
    node_name: Label
    input_references: list[RefName] = Field(default_factory=list)
    output_reference: RefName | None = None
    confirmation_status: ConfirmationStatus = "unset"
    open_questions: list[OpenQuestion] = Field(default_factory=list)

    @model_validator(mode="after")
    def _references_shape(self) -> NodeBase:
        node_type: str = getattr(self, "node_type")
        lo, hi = _INPUT_COUNT.get(node_type, _DEFAULT_INPUT_COUNT)
        n = len(self.input_references)
        if n < lo or (hi is not None and n > hi):
            expected = f"{lo}個" if lo == hi else f"{lo}〜{hi}個"
            raise ValueError(f"{node_type} の input_references は{expected}です（指定：{n}個）")
        if len(set(self.input_references)) != n:
            raise ValueError("input_references に同じ参照が重複しています")
        if node_type == "output":
            if self.output_reference is not None:
                raise ValueError("output ノードは output_reference を持てません")
        elif self.output_reference is None:
            raise ValueError("output_reference が必要です")
        return self


class LoadNode(NodeBase):
    node_type: Literal["load"]
    parameters: LoadParams


class FilterNode(NodeBase):
    node_type: Literal["filter"]
    parameters: FilterParams


class SortNode(NodeBase):
    node_type: Literal["sort"]
    parameters: SortParams


class SelectColumnsNode(NodeBase):
    node_type: Literal["select_columns"]
    parameters: SelectColumnsParams


class RenameColumnsNode(NodeBase):
    node_type: Literal["rename_columns"]
    parameters: RenameColumnsParams


class DropColumnsNode(NodeBase):
    node_type: Literal["drop_columns"]
    parameters: DropColumnsParams


class AddConstantNode(NodeBase):
    node_type: Literal["add_constant"]
    parameters: AddConstantParams


class CastNode(NodeBase):
    node_type: Literal["cast"]
    parameters: CastParams


class DuplicatesNode(NodeBase):
    node_type: Literal["duplicates"]
    parameters: DuplicatesParams


class MissingNode(NodeBase):
    node_type: Literal["missing"]
    parameters: MissingParams


class JoinNode(NodeBase):
    node_type: Literal["join"]
    parameters: JoinParams


class ConcatNode(NodeBase):
    node_type: Literal["concat"]
    parameters: ConcatParams

    @model_validator(mode="after")
    def _sources_match(self) -> ConcatNode:
        if [s.reference for s in self.parameters.sources] != self.input_references:
            raise ValueError("parameters.sources の参照は input_references と同じ順序で並べてください")
        return self


class AggregateNode(NodeBase):
    node_type: Literal["aggregate"]
    parameters: AggregateParams


class CalculateNode(NodeBase):
    node_type: Literal["calculate"]
    parameters: CalculateParams


class OutputNode(NodeBase):
    node_type: Literal["output"]
    parameters: OutputParams

    @model_validator(mode="after")
    def _sheets_match(self) -> OutputNode:
        if [s.reference for s in self.parameters.sheets] != self.input_references:
            raise ValueError("parameters.sheets の参照は input_references と同じ順序で並べてください")
        return self


Node = Annotated[
    Union[
        LoadNode,
        FilterNode,
        SortNode,
        SelectColumnsNode,
        RenameColumnsNode,
        DropColumnsNode,
        AddConstantNode,
        CastNode,
        DuplicatesNode,
        MissingNode,
        JoinNode,
        ConcatNode,
        AggregateNode,
        CalculateNode,
        OutputNode,
    ],
    Field(discriminator="node_type"),
]

NODE_TYPES: tuple[str, ...] = (
    "load",
    "filter",
    "sort",
    "select_columns",
    "rename_columns",
    "drop_columns",
    "add_constant",
    "cast",
    "duplicates",
    "missing",
    "join",
    "concat",
    "aggregate",
    "calculate",
    "output",
)


# ---------------------------------------------------------------------------
# フロー全体
# ---------------------------------------------------------------------------


class Dependency(StrictModel):
    node_id: RefName
    depends_on: list[RefName]


class ValidationRules(StrictModel):
    # 結合で行が増えてよい上限（1.0＝増加を認めない）
    max_row_growth_ratio: Annotated[Decimal, Field(ge=1, le=100)] = Decimal("1.0")
    # 金額比較の許容差
    amount_tolerance: Annotated[Decimal, Field(ge=0)] = Decimal("0")


class FlowDefinition(StrictModel):
    schema_version: Literal["1.0"]
    engine_version: str
    flow_id: UUID
    flow_version: Annotated[int, Field(ge=1)]
    flow_name: Annotated[str, Field(min_length=1, max_length=100)]
    description: Annotated[str, Field(max_length=2000)] = ""
    created_at: datetime
    updated_at: datetime
    input_definitions: list[InputDefinition] = Field(default_factory=list)
    nodes: Annotated[list[Node], Field(max_length=MAX_NODES)] = Field(default_factory=list)
    dependencies: list[Dependency] = Field(default_factory=list)
    validation_rules: ValidationRules = Field(default_factory=ValidationRules)


# 自己参照している（入れ子になる）モデルの型情報を確定させる
ConditionGroup.model_rebuild()
BinaryOperation.model_rebuild()
FilterParams.model_rebuild()
CalculateParams.model_rebuild()
