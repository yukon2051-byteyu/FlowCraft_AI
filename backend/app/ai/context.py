"""AI業務改善診断の材料（A-2：情報の収集）。AIは呼ばない。

今ある情報を集めて、AIに送る文章を1つ作る。画面には、この文章をそのまま見せる（見せたものと違うものを送らない）。
  - 画面から受け取る：業務の名前・目的、作業手順（処理ステップ・完了基準）
  - サーバーにあるファイルから読む：列・形式・件数・空欄の数・種類の数・値の例・数値と日付の範囲
個人情報と思われる列（名前・値の形で判定）は、列名と件数だけを送り、値は送らない。送らなかったことも示す。
ない情報を、あるものとして扱わない（足りないことは missing に書き、AIにも「ない」と伝える）。
指紋（SHA-256）：同じ材料を何度もAIに送らないために使う（A-3 以降）。
"""

from __future__ import annotations

import hashlib
import re
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field

from app.files.profile import build_table, profile_columns
from app.files.service import get_file
from app.sessions.store import Session

MAX_FILES = 5
MAX_COLUMNS_PER_FILE = 60
MAX_SAMPLES = 3
MAX_SAMPLE_CHARS = 30
MAX_TEXT_CHARS = 30_000

TYPE_LABEL = {"string": "文字", "integer": "整数", "decimal": "小数", "date": "日付", "boolean": "はい／いいえ"}
NODE_LABEL = {
    "load": "ファイルを読み込む",
    "filter": "条件に合う行だけ残す",
    "sort": "並べ替える",
    "select_columns": "必要な列を取り出す",
    "rename_columns": "列名を変える",
    "drop_columns": "列を削除する",
    "add_constant": "決まった値の列を追加する",
    "cast": "データの形式をそろえる",
    "duplicates": "重複を扱う",
    "missing": "空欄を扱う",
    "join": "別の表から情報を付け加える",
    "concat": "表を縦にまとめる",
    "aggregate": "項目ごとに合計・集計する",
    "calculate": "計算した列を追加する",
    "output": "Excelに出力する",
}
ON_FAIL_LABEL = {"critical": "重大", "caution": "注意", "record": "記録のみ"}

# 個人情報と思われる列名（値は送らない）
_PII_NAME = re.compile(r"氏名|名前|姓|住所|電話|携帯|ＴＥＬ|TEL|tel|FAX|メール|mail|Mail|生年月日|誕生日|年齢|性別|口座|カード番号|マイナンバー|個人番号|郵便番号|〒|担当者名|社員名|顧客名")
# 個人情報と思われる値の形（列名で分からないときの念のため）
_PII_VALUE = [
    re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"),  # メールアドレス
    re.compile(r"^0\d{1,4}-\d{1,4}-\d{3,4}$"),  # 電話番号（区切りあり）
    re.compile(r"^0[5789]0\d{8}$"),  # 携帯電話（区切りなし）
    re.compile(r"^\d{3}-\d{4}$"),  # 郵便番号
]


class FileRef(BaseModel):
    file_id: str = Field(max_length=100)
    sheet: str | None = Field(default=None, max_length=200)
    header_row: int = Field(default=1, ge=1, le=1000)
    label: str | None = Field(default=None, max_length=100)  # 作業手順での入力の名前（例：売上実績）


class ContextRequest(BaseModel):
    name: str = Field(default="", max_length=100)
    purpose: str = Field(default="", max_length=2000)
    flow: dict[str, Any] | None = None
    files: list[FileRef] = Field(default_factory=list, max_length=MAX_FILES)


class ContextSection(BaseModel):
    key: str
    title: str
    lines: list[str]


class ContextPreview(BaseModel):
    sections: list[ContextSection]
    excluded: list[str]  # 送らない情報（個人情報の可能性など）
    missing: list[str]  # 足りない情報（ないものを、あるものとして扱わない）
    text: str  # AIに送る文章（画面に見せるものと同じ）
    chars: int
    fingerprint: str


def _is_pii_value(s: str) -> bool:
    return any(p.search(s) for p in _PII_VALUE)


def _short(v: str) -> str:
    v = v.replace("\n", " ")
    return v if len(v) <= MAX_SAMPLE_CHARS else v[:MAX_SAMPLE_CHARS] + "…"


def _as_number(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return v
    try:
        return float(str(v).replace(",", ""))
    except ValueError:
        return None


def _as_date(v: Any) -> date | None:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v).strip().replace("/", "-")[:10])
    except ValueError:
        return None


def _range(values: list[Any], inferred: str) -> str | None:
    """数値・日付の列の範囲（CSV の値は文字なので、列の形式に合わせて読み替える）。読み替えられない値があれば出さない"""
    if not values:
        return None
    if inferred in ("integer", "decimal"):
        nums = [_as_number(v) for v in values]
        if all(n is not None for n in nums):
            lo, hi = min(nums), max(nums)  # type: ignore[type-var]
            fmt = (lambda x: f"{int(x):,}") if all(float(n).is_integer() for n in nums) else (lambda x: f"{x:,}")  # type: ignore[arg-type]
            return f"{fmt(lo)}〜{fmt(hi)}"
    if inferred == "date":
        ds = [_as_date(v) for v in values]
        if all(d is not None for d in ds):
            return f"{min(ds).isoformat()}〜{max(ds).isoformat()}"  # type: ignore[type-var]
    return None


def _file_section(session: Session, ref: FileRef, excluded: list[str]) -> ContextSection:
    f = get_file(session, ref.file_id)
    sheet = ref.sheet or f.default_sheet()
    raw = f.sheets.get(sheet)
    title = f"Excel・CSV：{ref.label or f.filename}"
    if raw is None:
        return ContextSection(key=f"file:{ref.file_id}", title=title, lines=[f"シート「{sheet}」が見つかりません（このファイルの情報は送りません）"])
    table = build_table(raw, ref.header_row, is_csv=f.kind == "csv")
    lines = [f"ファイル名：{f.filename}（シート「{sheet}」・見出しは{ref.header_row}行目）", f"データの行数：{len(table.rows):,}行・列数：{len(table.columns)}列"]
    profiles = profile_columns(table)
    for i, p in enumerate(profiles[:MAX_COLUMNS_PER_FILE]):
        values = [r[i] for r in table.rows if r[i] is not None and r[i] != ""]
        head = f"列「{p.name}」：{TYPE_LABEL.get(p.inferred_type, p.inferred_type)}・空欄{p.null_count:,}件・種類{p.unique_count:,}"
        pii = bool(_PII_NAME.search(p.name)) or any(_is_pii_value(str(s)) for s in p.samples)
        if pii:
            excluded.append(f"{ref.label or f.filename}の列「{p.name}」の値（個人情報の可能性があるため、列名と件数だけを送ります）")
            lines.append(f"{head}・値は送りません（個人情報の可能性）")
            continue
        rng = _range(values, p.inferred_type)
        samples = "、".join(_short(s) for s in p.samples[:MAX_SAMPLES])
        lines.append(head + (f"・範囲{rng}" if rng else "") + (f"・例：{samples}" if samples else ""))
    if len(profiles) > MAX_COLUMNS_PER_FILE:
        lines.append(f"（ほか{len(profiles) - MAX_COLUMNS_PER_FILE}列は省略）")
    return ContextSection(key=f"file:{ref.file_id}", title=title, lines=lines)


def _flow_sections(flow: dict[str, Any]) -> list[ContextSection]:
    nodes = [n for n in flow.get("nodes") or [] if isinstance(n, dict)]
    out: list[ContextSection] = []
    if nodes:
        ref_step = {n.get("output_reference"): i + 1 for i, n in enumerate(nodes) if n.get("output_reference")}
        lines = []
        for i, n in enumerate(nodes):
            kind = NODE_LABEL.get(str(n.get("node_type")), str(n.get("node_type")))
            uses = [f"ステップ{ref_step[r]}" for r in n.get("input_references") or [] if r in ref_step]
            lines.append(f"ステップ{i + 1}：{n.get('node_name') or kind}（{kind}）" + (f"・使うデータ：{'・'.join(uses)}" if uses else ""))
        out.append(ContextSection(key="steps", title=f"作業手順（処理ステップ {len(nodes)}）", lines=lines))
    items = [c for c in (flow.get("completion_criteria") or {}).get("items") or [] if isinstance(c, dict)]
    if items:
        lines = [
            f"{c.get('name')}（{ON_FAIL_LABEL.get(str(c.get('on_fail')), '')}）" + ("・内容は未確認" if c.get("confirmation_status") == "pending" else "")
            for c in items
        ]
        out.append(ContextSection(key="criteria", title=f"品質ルール（完了基準 {len(items)}）", lines=lines))
    return out


def build_context(session: Session, req: ContextRequest) -> ContextPreview:
    sections: list[ContextSection] = []
    excluded: list[str] = []
    missing: list[str] = []

    biz = []
    if req.name.strip():
        biz.append(f"作業の名前：{req.name.strip()}")
    if req.purpose.strip():
        biz.append(f"やりたい作業・目的：{req.purpose.strip()}")
    else:
        missing.append("業務の目的が入力されていません（AIが質問することがあります）")
    if biz:
        sections.append(ContextSection(key="business", title="業務", lines=biz))

    flow_sections = _flow_sections(req.flow) if req.flow else []
    sections += flow_sections
    if not any(s.key == "steps" for s in flow_sections):
        missing.append("作業手順はまだありません（業務の説明とデータから考えます）")
    if not any(s.key == "criteria" for s in flow_sections):
        missing.append("品質ルール（完了基準）はまだ設定されていません")

    for ref in req.files:
        sections.append(_file_section(session, ref, excluded))
    if not req.files:
        missing.append("Excel・CSVがまだ読み込まれていません。今の情報でできる範囲の暫定的な診断になります（読み込んだ後に、分析を深められます）")
    missing.append("過去の実行結果・品質異常の履歴は、このブラウザにだけあり、今回は送りません（今後対応）")

    text = "\n\n".join(f"## {s.title}\n" + "\n".join(f"- {line}" for line in s.lines) for s in sections)
    text += "\n\n## 足りない情報（ないものとして扱ってください）\n" + "\n".join(f"- {m}" for m in missing)
    if len(text) > MAX_TEXT_CHARS:
        text = text[:MAX_TEXT_CHARS] + "\n（長いため、ここまでを送ります）"
    return ContextPreview(
        sections=sections,
        excluded=excluded,
        missing=missing,
        text=text,
        chars=len(text),
        fingerprint=hashlib.sha256(text.encode("utf-8")).hexdigest(),
    )
