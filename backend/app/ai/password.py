"""AI使用パスワードのハッシュ（元のパスワードに戻せない値）を作る・照合する。

標準ライブラリの PBKDF2（同じ計算を何十万回もくり返し、総当たりを遅くする）を使う。新しいライブラリは使わない。
照合は hmac.compare_digest で行い、比べる時間からパスワードを推測されないようにする。

ハッシュの作り方（backend フォルダで。入力した文字は画面に表示されない）：
    .venv\\Scripts\\python.exe -m app.ai.password
表示された値を backend/.env の AI_PASSWORD_HASH= に書く（パスワードそのものは、どこにも書かない）。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets

_ALGORITHM = "pbkdf2_sha256"
_ITERATIONS = 310_000


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def hash_password(password: str, iterations: int = _ITERATIONS) -> str:
    """「方式$くり返し回数$塩$ハッシュ」の形で返す（塩：パスワードごとに変える乱数）。"""
    if not password:
        raise ValueError("パスワードを入力してください")
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"{_ALGORITHM}${iterations}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, encoded: str) -> bool:
    """パスワードがハッシュと合うか。形の崩れたハッシュでは常に False（例外にしない）。"""
    try:
        algorithm, iterations, salt_b64, digest_b64 = encoded.split("$")
        if algorithm != _ALGORITHM:
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(digest_b64)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iterations))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


# AI使用パスワードの最短の長さ（推測されにくくするため。12文字以上を勧める）
MIN_PASSWORD_LENGTH = 8


if __name__ == "__main__":
    import getpass

    first = getpass.getpass("AI使用パスワード（8文字以上）：")
    if len(first) < MIN_PASSWORD_LENGTH:
        raise SystemExit(f"パスワードが短すぎます（{len(first)}文字）。{MIN_PASSWORD_LENGTH}文字以上にして、もう一度やり直してください。")
    again = getpass.getpass("もう一度入力：")
    if first != again:
        raise SystemExit("2回の入力が一致しません。もう一度やり直してください。")
    print("backend/.env に次の1行を書いてください（パスワードそのものは書かないでください）：")
    print(f"AI_PASSWORD_HASH={hash_password(first)}")
