"""ファイルの種類・安全性・文字コードの判定（設計書 §10.2）。

拡張子は「自己申告」にすぎないので信用しない。ファイルの先頭のバイト（署名）と中身の構造で判定する。
- xlsx ：ZIP形式で、Excelに必要な部品（[Content_Types].xml, xl/workbook.xml）を含む
- csv  ：NUL文字を含まず、UTF-8 / UTF-8(BOM) / CP932(Shift_JIS) のいずれかで読める
- 拒否 ：パスワード付きExcel・旧形式(.xls)（OLE形式）、マクロ付き、ZIP爆弾、拡張子と中身の不一致
"""

from __future__ import annotations

import io
import re
import unicodedata
import zipfile
from typing import Literal

from app.errors import AppError

FileKind = Literal["xlsx", "csv"]

_ZIP_SIGNATURE = b"PK\x03\x04"
_OLE_SIGNATURE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"  # 暗号化xlsx・.xls・.doc などの共通形式
_ALLOWED_EXTENSIONS: dict[str, FileKind] = {".xlsx": "xlsx", ".csv": "csv"}
_ENCODING_LABEL = {"utf-8-sig": "UTF-8（BOM付き）", "utf-8": "UTF-8", "cp932": "Shift_JIS（CP932）"}


def file_error(code: str, message: str, how_to_fix: str, cause: str | None = None, status: int = 400) -> AppError:
    return AppError(status, code, message, cause=cause, how_to_fix=how_to_fix)


def safe_filename(name: str | None) -> str:
    """表示用の安全なファイル名にする。保存パスには一切使わない。

    "..\\..\\evil.csv" → "evil.csv"、制御文字の除去、長さ制限
    """
    name = name or "名称未設定"
    name = re.split(r"[\\/]", name)[-1]  # フォルダ部分を捨てる
    name = "".join(ch for ch in name if unicodedata.category(ch)[0] != "C")  # 制御文字を除去
    name = unicodedata.normalize("NFC", name).strip().lstrip(".")
    if not name:
        name = "名称未設定"
    return name[:120]


def extension_kind(filename: str) -> FileKind:
    lower = filename.lower()
    for ext, kind in _ALLOWED_EXTENSIONS.items():
        if lower.endswith(ext):
            return kind
    if lower.endswith((".xls", ".xlsm", ".xlsb")):
        raise file_error(
            "UNSUPPORTED_EXCEL_FORMAT",
            f"「{filename}」は対応していないExcel形式です。",
            how_to_fix="Excelで開き、「名前を付けて保存」で「Excelブック（*.xlsx）」を選んで保存し直してください。",
            cause="旧形式（.xls）やマクロ付き（.xlsm）、バイナリ形式（.xlsb）には対応していません。",
        )
    raise file_error(
        "UNSUPPORTED_FILE_TYPE",
        f"「{filename}」は対応していないファイル形式です。",
        how_to_fix="Excel（.xlsx）またはCSV（.csv）ファイルを選んでください。Accessのデータは、ExcelかCSVに書き出してからお使いください。",
    )


def detect_kind(data: bytes, filename: str, max_uncompressed_bytes: int) -> FileKind:
    """中身から種類を判定し、拡張子と一致するか確認する。"""
    if len(data) == 0:
        raise file_error("EMPTY_FILE", f"「{filename}」は空のファイルです。", how_to_fix="データが入っているファイルを選んでください。")

    claimed = extension_kind(filename)

    if data.startswith(_OLE_SIGNATURE):
        raise file_error(
            "ENCRYPTED_OR_LEGACY_EXCEL",
            f"「{filename}」はパスワード付き、または旧形式のExcelファイルです。",
            how_to_fix="パスワードを解除するか、「Excelブック（*.xlsx）」形式で保存し直してください。",
            cause="パスワードで保護されたファイルは安全上の理由で読み込めません。",
        )

    if data.startswith(_ZIP_SIGNATURE):
        if claimed != "xlsx":
            raise _mismatch(filename, "Excel（.xlsx）", ".csv")
        _check_xlsx_container(data, filename, max_uncompressed_bytes)
        return "xlsx"

    # ZIPでなければCSVとして扱えるか確認する
    if claimed == "xlsx":
        raise _mismatch(filename, "Excel以外（テキストなど）", ".xlsx")
    if b"\x00" in data[:65536]:
        raise file_error(
            "BINARY_NOT_CSV",
            f"「{filename}」はCSV（テキスト）ではないようです。",
            how_to_fix="Excelなどで開いて「CSV UTF-8（コンマ区切り）」形式で保存し直してください。",
        )
    return "csv"


def _mismatch(filename: str, actual: str, ext: str) -> AppError:
    return file_error(
        "EXTENSION_MISMATCH",
        f"「{filename}」の拡張子（{ext}）と中身（{actual}）が一致しません。",
        how_to_fix="元のアプリで正しい形式を選んで保存し直してください。拡張子だけを書き換えたファイルは読み込めません。",
    )


def _check_xlsx_container(data: bytes, filename: str, max_uncompressed_bytes: int) -> None:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            names = set(zf.namelist())
            total = sum(info.file_size for info in zf.infolist())
    except zipfile.BadZipFile:
        raise file_error(
            "CORRUPTED_XLSX", f"「{filename}」は壊れているため読み込めません。", how_to_fix="Excelで開けるか確認し、保存し直してください。"
        ) from None

    if "[Content_Types].xml" not in names or "xl/workbook.xml" not in names:
        raise file_error(
            "NOT_EXCEL_WORKBOOK",
            f"「{filename}」はExcelブックではありません（ZIP形式の別のファイルです）。",
            how_to_fix="Excel（.xlsx）ファイルを選んでください。",
        )
    if "xl/vbaProject.bin" in names:
        raise file_error(
            "MACRO_NOT_SUPPORTED",
            f"「{filename}」にはマクロ（VBA）が含まれています。",
            how_to_fix="マクロを含まない「Excelブック（*.xlsx）」形式で保存し直してください。",
            cause="安全のため、マクロを含むファイルは読み込みません。",
        )
    if total > max_uncompressed_bytes:
        # 小さなファイルが展開すると巨大になる「ZIP爆弾」対策
        raise file_error(
            "XLSX_TOO_LARGE_UNCOMPRESSED",
            f"「{filename}」は展開後のサイズが大きすぎるため読み込めません。",
            how_to_fix="不要なシートや書式を削除し、データ量を減らしてから読み込んでください。",
            status=413,
        )


def decode_csv(data: bytes, filename: str) -> tuple[str, str]:
    """CSVの文字コードを判定してテキストに変換する。戻り値：(テキスト, 文字コード名)"""
    # 先頭にBOM（UTF-8の目印 EF BB BF）があればBOM付きUTF-8、なければUTF-8→CP932の順に試す
    candidates = ("utf-8-sig",) if data.startswith(b"\xef\xbb\xbf") else ("utf-8", "cp932")
    for enc in candidates:
        try:
            text = data.decode(enc)
        except UnicodeDecodeError:
            continue
        return text, _ENCODING_LABEL[enc]
    raise file_error(
        "UNKNOWN_ENCODING",
        f"「{filename}」の文字コードを判別できません。",
        how_to_fix="Excelで開いて「CSV UTF-8（コンマ区切り）」形式で保存し直してください。",
        cause="対応している文字コードは UTF-8 と Shift_JIS（CP932）です。",
    )
