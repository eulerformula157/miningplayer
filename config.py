import os
from pathlib import Path


def load_env_file(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()

        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")

        if key and key not in os.environ:
            os.environ[key] = value


PROJECT_DIR = Path(__file__).resolve().parent

load_env_file(PROJECT_DIR / ".env")

DEFAULT_BASE_DIR = PROJECT_DIR
BASE_DIR = Path(os.getenv("PLAYER_SERVER_BASE_DIR", str(DEFAULT_BASE_DIR))).resolve()

PLAYER_DIR = BASE_DIR / "Player"
VIDEO_DIR = BASE_DIR / "UploadedVideos"
ANKI_HIGHLIGHT_CACHE_DIR = BASE_DIR / "anki_highlight_cache"

anki_media_dir_raw = os.getenv("ANKI_MEDIA_DIR")

if not anki_media_dir_raw:
    raise RuntimeError(
        "ANKI_MEDIA_DIR is not set. Create .env from .env.example and set your Anki collection.media path."
    )

ANKI_MEDIA_DIR = Path(anki_media_dir_raw).expanduser().resolve()

SCREENSHOT_DIR = ANKI_MEDIA_DIR
AUDIO_DIR = ANKI_MEDIA_DIR

ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN")
ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".mkv", ".avi", ".mov", ".webm"}

DEDUPE_INDEX_PATH = BASE_DIR / "dedupe_index.json"
PORT = int(os.getenv("PORT", "5000"))

