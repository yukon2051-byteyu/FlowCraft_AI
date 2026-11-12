"""計算式の評価（設計書 §6.1・flow-schema.md §4.4）。

計算式は文字列ではなく「木構造のデータ」で受け取り、ここで許可した演算
（加算・減算・乗算・除算・比率）だけを、Pythonの if 文で1つずつ処理する。
eval / exec は使わないので、式に命令を紛れ込ませても実行されることはない。

- 計算はすべて Decimal で行う
- 計算に使う値が空欄なら、結果も空欄（勝手に0とみなさない）
- 0で割る行は結果を空欄にし、行番号を記録する（ノード側で警告／エラーを判断）
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal, DivisionByZero, InvalidOperation
from typing import Any

from app.engine.numeric import CONTEXT
from app.flow.schema import MAX_EXPRESSION_DEPTH, BinaryOperation, ColumnOperand, ConstantOperand

Expr = ColumnOperand | ConstantOperand | BinaryOperation

_HUNDRED = Decimal(100)


class ExpressionError(Exception):
    """式そのものに問題がある（存在しない列・数値でない列・深すぎる式）。"""


@dataclass
class ExpressionResult:
    values: list[Decimal | None]
    zero_division_rows: list[int] = field(default_factory=list)  # 0で割った行（0始まり）
    null_rows: int = 0  # 空欄が含まれて計算できなかった行数


def referenced_columns(expr: Expr) -> list[str]:
    """式が使っている列名（重複なし・登場順）。"""
    if isinstance(expr, ColumnOperand):
        return [expr.column]
    if isinstance(expr, ConstantOperand):
        return []
    out: list[str] = []
    for c in referenced_columns(expr.left) + referenced_columns(expr.right):
        if c not in out:
            out.append(c)
    return out


def _depth(expr: Expr) -> int:
    if isinstance(expr, BinaryOperation):
        return 1 + max(_depth(expr.left), _depth(expr.right))
    return 0


class _ZeroDivision(Exception):
    pass


def _eval(expr: Expr, row: dict[str, Any]) -> Decimal | None:
    """1行分の計算。許可した型・演算以外は ExpressionError。"""
    if isinstance(expr, ConstantOperand):
        return Decimal(expr.value or "0")
    if isinstance(expr, ColumnOperand):
        v = row[expr.column]
        if v is None:
            return None
        if isinstance(v, bool) or not isinstance(v, (int, Decimal)):
            raise ExpressionError(f"列「{expr.column}」に数値以外の値があります: {v!r}")
        return Decimal(v)
    if not isinstance(expr, BinaryOperation):
        raise ExpressionError(f"使用できない式の要素です: {type(expr).__name__}")

    left = _eval(expr.left, row)
    right = _eval(expr.right, row)
    if left is None or right is None:
        return None
    op = expr.op
    if op == "add":
        return CONTEXT.add(left, right)
    if op == "subtract":
        return CONTEXT.subtract(left, right)
    if op == "multiply":
        return CONTEXT.multiply(left, right)
    if op in ("divide", "ratio_percent"):
        if right == 0:
            raise _ZeroDivision()
        q = CONTEXT.divide(left, right)
        return CONTEXT.multiply(q, _HUNDRED) if op == "ratio_percent" else q
    raise ExpressionError(f"使用できない演算です: {op}")


def evaluate(expr: Expr, columns: dict[str, list[Any]], numeric_columns: set[str]) -> ExpressionResult:
    """表の全行について式を計算する。

    columns：列名 → 値のリスト（行数はすべて同じ）
    numeric_columns：数値型（integer / decimal）の列名。それ以外の列を計算に使うとエラー
    """
    if _depth(expr) > MAX_EXPRESSION_DEPTH:
        raise ExpressionError(f"計算式の入れ子は{MAX_EXPRESSION_DEPTH}段までです")
    used = referenced_columns(expr)
    missing = [c for c in used if c not in columns]
    if missing:
        raise ExpressionError(f"計算式で使う列がありません: {'、'.join(missing)}")
    not_numeric = [c for c in used if c not in numeric_columns]
    if not_numeric:
        raise ExpressionError(f"数値ではない列は計算に使えません: {'、'.join(not_numeric)}（先に型変換してください）")

    n = len(next(iter(columns.values()))) if columns else 0
    result = ExpressionResult(values=[])
    for i in range(n):
        row = {c: columns[c][i] for c in used}
        try:
            v = _eval(expr, row)
        except (_ZeroDivision, DivisionByZero):
            result.zero_division_rows.append(i)
            v = None
        except InvalidOperation as e:  # 桁あふれなど
            raise ExpressionError(f"{i + 1}行目の計算ができません（{e.__class__.__name__}）") from None
        else:
            if v is None:
                result.null_rows += 1
        result.values.append(v)
    return result
