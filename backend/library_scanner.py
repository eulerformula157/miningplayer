import re
from pathlib import Path
from typing import Optional

from backend.library_db import get_db


def normalize_title(value: str) -> str:
    text = str(value or "").lower()
    text = re.sub(r"\[[^\]]*\]", " ", text)
    text = re.sub(r"\([^\)]*\)", " ", text)
    text = re.sub(r"[^a-z0-9а-яё一-龯ぁ-んァ-ン]+", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def clean_series_title(value: str) -> str:
    text = str(value or "").strip()
    text = re.sub(r"\[[^\]]*\]", " ", text)
    text = re.sub(r"\([^\)]*\)", " ", text)
    for pattern in [
        r"\bBDRip\b", r"\bBluRay\b", r"\bWEBRip\b", r"\bWEB-DL\b", r"\bDVDRip\b", r"\bHDTV\b",
        r"\bHEVC\b", r"\bH\.?264\b", r"\bx264\b", r"\bx265\b", r"\bAVC\b", r"\bAAC\b",
        r"\bFLAC\b", r"\bTrueHD\b", r"\bOpus\b", r"\b10bit\b", r"\b8bit\b", r"\b\d{3,4}p\b", r"\b\d{3,4}x\d{3,4}\b",
    ]:
        text = re.sub(pattern, " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+", " ", text).strip(" ._-")
    return text or "Unknown Series"


def detect_episode(path: Path) -> tuple[Optional[int], Optional[float]]:
    name = path.stem
    sxe = re.search(r"[Ss](\d{1,2})[Ee](\d{1,3})(?:\D|$)", name)
    if sxe:
        return int(sxe.group(1)), float(sxe.group(2))

    bracket_numbers = re.findall(r"\[(\d{1,3})(?:v\d+)?\]", name, flags=re.IGNORECASE)
    for raw_number in bracket_numbers:
        number = int(raw_number)
        if 1 <= number <= 200:
            return None, float(number)

    dash_number = re.search(r"(?:^|[\s._-])(?:ep|episode)?[\s._-]*(\d{1,3})(?:v\d+)?(?:\D|$)", name, re.IGNORECASE)
    if dash_number:
        number = int(dash_number.group(1))
        if 1 <= number <= 200:
            return None, float(number)
    return None, None


def infer_series_title(media_root: Path, path: Path) -> str:
    relative = path.relative_to(media_root)
    ignored_folder_names = {"anime", "videos", "video", "series", "shows", "completed", "watching", "downloaded", "downloads", "subs", "subtitles"}
    for part in list(relative.parts[:-1]):
        normalized_part = normalize_title(part)
        if normalized_part.isdigit() or normalized_part in ignored_folder_names:
            continue
        cleaned = clean_series_title(part)
        if cleaned and normalize_title(cleaned):
            return cleaned

    name = path.stem
    name = re.sub(r"\[[^\]]*\]", " ", name)
    name = re.sub(r"\([^\)]*\)", " ", name)
    name = re.sub(r"[Ss]\d{1,2}[Ee]\d{1,3}.*$", " ", name)
    name = re.sub(r"[-_.\s]+(?:ep|episode)?[-_.\s]*\d{1,3}.*$", " ", name, flags=re.IGNORECASE)
    name = re.sub(r"\s+", " ", name).strip(" ._-")
    return clean_series_title(name)


def build_episode_title(episode_number: Optional[float]) -> str:
    if episode_number is None:
        return "Episode Unknown"
    if episode_number.is_integer():
        return f"Episode {int(episode_number):02d}"
    return f"Episode {episode_number:g}"


def build_normalized_episode_key(normalized_series_title: str, season_number: Optional[int], episode_number: Optional[float], path: Path) -> str:
    season_part = str(season_number or 1)
    if episode_number is None:
        return f"{normalized_series_title}|unknown|{normalize_title(path.stem)}"
    return f"{normalized_series_title}|s{season_part}|e{episode_number:g}"


def get_or_create_series(conn, title: str) -> int:
    normalized_title = normalize_title(title)
    row = conn.execute("SELECT id FROM series WHERE normalized_title = ?", (normalized_title,)).fetchone()
    if row:
        conn.execute("UPDATE series SET title = ?, sort_title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (title, normalized_title, row["id"]))
        return int(row["id"])
    cur = conn.execute("INSERT INTO series(title, normalized_title, sort_title) VALUES(?, ?, ?)", (title, normalized_title, normalized_title))
    return int(cur.lastrowid)


def get_or_create_episode(conn, series_id: int, normalized_key: str, episode_number: Optional[float], season_number: Optional[int], title: str) -> int:
    row = conn.execute("SELECT id FROM episodes WHERE normalized_key = ?", (normalized_key,)).fetchone()
    if row:
        conn.execute(
            "UPDATE episodes SET series_id = ?, episode_number = ?, season_number = ?, title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (series_id, episode_number, season_number, title, row["id"]),
        )
        return int(row["id"])
    cur = conn.execute(
        "INSERT INTO episodes(series_id, episode_number, season_number, title, normalized_key) VALUES(?, ?, ?, ?, ?)",
        (series_id, episode_number, season_number, title, normalized_key),
    )
    return int(cur.lastrowid)


def upsert_library_file(conn, series_id: int, episode_id: int, file_type: str, path: Path, relative_path: str, is_primary: bool) -> int:
    absolute_path = str(path)
    row = conn.execute("SELECT id FROM library_files WHERE path = ?", (absolute_path,)).fetchone()
    if row:
        conn.execute(
            """
            UPDATE library_files
            SET series_id = ?, episode_id = ?, file_type = ?, relative_path = ?, file_exists = 1, is_primary = ?,
                missing_since = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (series_id, episode_id, file_type, relative_path, 1 if is_primary else 0, row["id"]),
        )
        return int(row["id"])
    cur = conn.execute(
        """
        INSERT INTO library_files(series_id, episode_id, file_type, path, relative_path, file_exists, is_primary, linked_at)
        VALUES(?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
        """,
        (series_id, episode_id, file_type, absolute_path, relative_path, 1 if is_primary else 0),
    )
    return int(cur.lastrowid)


def scan_library(db_path: Path, media_root: Path, video_extensions: set[str], subtitle_extensions: set[str]) -> dict:
    media_root = media_root.resolve()
    if not media_root.exists():
        return {"ok": False, "error": f"MEDIA_LIBRARY_DIR does not exist: {media_root}"}
    if not media_root.is_dir():
        return {"ok": False, "error": f"MEDIA_LIBRARY_DIR is not a directory: {media_root}"}

    allowed_extensions = {ext.lower() for ext in video_extensions | subtitle_extensions}
    found_files = [path.resolve() for path in media_root.rglob("*") if path.is_file() and path.suffix.lower() in allowed_extensions]
    found_files.sort(key=lambda item: str(item).lower())

    summary = {
        "ok": True,
        "mediaLibraryDir": str(media_root),
        "filesFound": len(found_files),
        "seriesTouched": 0,
        "episodesTouched": 0,
        "videoFiles": 0,
        "subtitleFiles": 0,
        "missingFilesMarked": 0,
        "sample": [],
    }
    touched_series_ids = set()
    touched_episode_ids = set()

    with get_db(db_path) as conn:
        conn.execute(
            """
            UPDATE library_files
            SET file_exists = 0, missing_since = COALESCE(missing_since, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
            """
        )

        for path in found_files:
            suffix = path.suffix.lower()
            file_type = "video" if suffix in video_extensions else "subtitle"
            if file_type == "video":
                summary["videoFiles"] += 1
            else:
                summary["subtitleFiles"] += 1

            series_title = infer_series_title(media_root, path)
            normalized_series_title = normalize_title(series_title)
            season_number, episode_number = detect_episode(path)
            episode_title = build_episode_title(episode_number)
            normalized_key = build_normalized_episode_key(normalized_series_title, season_number, episode_number, path)

            series_id = get_or_create_series(conn, series_title)
            episode_id = get_or_create_episode(conn, series_id, normalized_key, episode_number, season_number, episode_title)
            relative_path = str(path.relative_to(media_root))
            upsert_library_file(conn, series_id, episode_id, file_type, path, relative_path, is_primary=True)

            touched_series_ids.add(series_id)
            touched_episode_ids.add(episode_id)

            if len(summary["sample"]) < 20:
                summary["sample"].append({
                    "series": series_title,
                    "episode": episode_title,
                    "fileType": file_type,
                    "relativePath": relative_path,
                })

        missing_row = conn.execute("SELECT COUNT(*) AS count FROM library_files WHERE file_exists = 0").fetchone()
        summary["missingFilesMarked"] = int(missing_row["count"])

    summary["seriesTouched"] = len(touched_series_ids)
    summary["episodesTouched"] = len(touched_episode_ids)
    return summary

