import os
from pathlib import Path

import werkzeug.utils


def is_within(base: Path, target: Path) -> bool:
    try:
        target.resolve().relative_to(base.resolve())
        return True
    except ValueError:
        return False


def safe_uploaded_filename(raw_filename: str, allowed_extensions: set[str]) -> str:
    filename = werkzeug.utils.secure_filename(raw_filename or "")

    if not filename:
        raise ValueError("Некорректное имя файла")

    ext = Path(filename).suffix.lower()

    if ext not in allowed_extensions:
        raise ValueError(f"Неподдерживаемый формат видео: {ext}")

    return filename


def safe_media_name(raw_name: str) -> str:
    name = os.path.basename(raw_name or "")

    if not name or name != raw_name:
        raise ValueError("Некорректное имя файла")

    return name


def safe_cache_key(raw_key: str) -> str:
    key = "".join(
        ch for ch in str(raw_key or "")
        if ch.isalnum() or ch in ("-", "_")
    )

    if not key:
        raise ValueError("Некорректный cache key")

    return key


def normalize_text(value: str) -> str:
    return " ".join((value or "").strip().split())


def to_float(value, fallback=0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback

