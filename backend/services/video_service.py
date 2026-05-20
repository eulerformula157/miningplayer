from pathlib import Path
from typing import Optional

from backend.config import LIBRARY_DB_PATH, MEDIA_LIBRARY_DIR, VIDEO_DIR
from backend.library_db import get_library_file_by_id
from backend.utils_validation import is_within, safe_media_name


def resolve_video_path_from_payload(data: dict) -> tuple[Optional[Path], Optional[dict], Optional[tuple]]:
    if not isinstance(data, dict):
        return None, None, ({"error": "Invalid JSON payload"}, 400)

    video_file_id = data.get("videoFileId")

    if video_file_id is not None:
        try:
            file_id = int(video_file_id)
        except (TypeError, ValueError):
            return None, None, ({"error": "Invalid videoFileId"}, 400)

        result = get_library_file_by_id(LIBRARY_DB_PATH, file_id)
        if not result.get("found"):
            return None, None, ({"error": "Library video file not found"}, 404)

        file_info = result["file"]
        if file_info.get("file_type") != "video":
            return None, None, ({"error": "Library file is not a video"}, 400)

        video_path = Path(file_info["path"]).resolve()
        if not is_within(MEDIA_LIBRARY_DIR, video_path):
            return None, None, ({"error": "Video file is outside MEDIA_LIBRARY_DIR"}, 403)
        if not video_path.exists() or not video_path.is_file():
            return None, None, ({"error": "Video file is missing"}, 404)

        return video_path, {
            "source": "library",
            "videoFileId": file_id,
            "path": str(video_path),
        }, None

    filename = data.get("filename")
    if not filename:
        return None, None, ({"error": "filename or videoFileId is required"}, 400)

    try:
        safe_filename = safe_media_name(filename)
    except ValueError as err:
        return None, None, ({"error": str(err)}, 400)

    video_path = (VIDEO_DIR / safe_filename).resolve()
    if not is_within(VIDEO_DIR, video_path):
        return None, None, ({"error": "Video file is outside VIDEO_DIR"}, 403)
    if not video_path.exists() or not video_path.is_file():
        return None, None, ({"error": "Video file not found"}, 404)

    return video_path, {
        "source": "uploaded",
        "filename": safe_filename,
        "path": str(video_path),
    }, None

