import os

from backend.config import (
    ANKI_HIGHLIGHT_CACHE_DIR,
    DEDUPE_INDEX_PATH,
    LIBRARY_DB_PATH,
    LIBRARY_COVERS_DIR,
    SCREENSHOT_DIR,
    VIDEO_DIR,
)
from backend.library_db import init_library_db


def ensure_directories() -> None:
    os.makedirs(VIDEO_DIR, exist_ok=True)
    os.makedirs(SCREENSHOT_DIR, exist_ok=True)
    os.makedirs(ANKI_HIGHLIGHT_CACHE_DIR, exist_ok=True)
    os.makedirs(LIBRARY_COVERS_DIR, exist_ok=True)


def cleanup_on_startup() -> None:
    print("--- Очистка временных файлов ---")

    if DEDUPE_INDEX_PATH.exists():
        try:
            DEDUPE_INDEX_PATH.unlink()
            print(f"Удален dedupe index: {DEDUPE_INDEX_PATH}")
        except Exception as err:
            print(f"Не удалось удалить dedupe index: {err}")

    for item in os.listdir(VIDEO_DIR):
        item_path = os.path.join(VIDEO_DIR, item)
        if item.startswith("temp_") or item.endswith((".mp4", ".mkv", ".avi", ".mov", ".webm", ".srt", ".ass", ".vtt")):
            try:
                os.remove(item_path)
                print(f"Удален файл: {item}")
            except Exception as err:
                print(f"Не удалось удалить {item}: {err}")


def initialize_backend() -> None:
    ensure_directories()
    cleanup_on_startup()
    init_library_db(LIBRARY_DB_PATH)

