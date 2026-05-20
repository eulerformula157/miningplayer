import hashlib
import json
from pathlib import Path
from typing import Optional

from backend.app_state import dedupe_lock
from backend.config import AUDIO_DIR, DEDUPE_INDEX_PATH, SCREENSHOT_DIR


def load_dedupe_index() -> dict:
    if not DEDUPE_INDEX_PATH.exists():
        return {"screenshot": {}, "audio": {}}
    try:
        data = json.loads(DEDUPE_INDEX_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {"screenshot": {}, "audio": {}}
        data.setdefault("screenshot", {})
        data.setdefault("audio", {})
        return data
    except Exception:
        return {"screenshot": {}, "audio": {}}


def save_dedupe_index(index_data: dict) -> None:
    DEDUPE_INDEX_PATH.write_text(
        json.dumps(index_data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def make_dedupe_key(kind: str, payload: dict) -> str:
    canonical = json.dumps(
        {"kind": kind, "payload": payload},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def get_cached_media(kind: str, dedupe_key: str) -> Optional[str]:
    with dedupe_lock:
        index_data = load_dedupe_index()
        filename = index_data.get(kind, {}).get(dedupe_key)
    if not filename:
        return None

    base_dir = SCREENSHOT_DIR if kind == "screenshot" else AUDIO_DIR
    file_path = base_dir / filename
    if file_path.exists() and file_path.stat().st_size > 0:
        return filename
    return None


def save_cached_media(kind: str, dedupe_key: str, filename: str) -> None:
    with dedupe_lock:
        index_data = load_dedupe_index()
        index_data.setdefault(kind, {})
        index_data[kind][dedupe_key] = filename
        save_dedupe_index(index_data)


def clean_srt_text_file(path: Path) -> None:
    import html
    import re

    text = path.read_text(encoding="utf-8-sig", errors="replace")
    text = re.sub(r"</?[^>\n]+>", "", text)
    text = html.unescape(text)
    path.write_text(text, encoding="utf-8")

