import json
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

from library_db import get_db


ANILIST_GRAPHQL_URL = "https://graphql.anilist.co"

ANILIST_SEARCH_QUERY = """
query ($search: String!) {
  Page(page: 1, perPage: 8) {
    media(type: ANIME, search: $search, sort: SEARCH_MATCH) {
      id
      title {
        romaji
        english
        native
        userPreferred
      }
      coverImage {
        large
        extraLarge
      }
      format
      seasonYear
      episodes
      siteUrl
    }
  }
}
"""


def _http_json_post(url: str, payload: dict, timeout: int = 12) -> dict:
    body = json.dumps(payload).encode("utf-8")

    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Bunmine/1.0",
        },
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read().decode("utf-8")

    return json.loads(raw)


def search_anilist_covers(query: str) -> list[dict]:
    query = str(query or "").strip()

    if not query:
        return []

    payload = {
        "query": ANILIST_SEARCH_QUERY,
        "variables": {
            "search": query,
        },
    }

    data = _http_json_post(ANILIST_GRAPHQL_URL, payload)

    media_items = (
        data.get("data", {})
        .get("Page", {})
        .get("media", [])
    )

    results = []

    for item in media_items:
        title = item.get("title") or {}
        cover = item.get("coverImage") or {}

        cover_url = cover.get("extraLarge") or cover.get("large")

        if not cover_url:
            continue

        results.append({
            "source": "anilist",
            "externalId": item.get("id"),
            "title": title.get("romaji") or title.get("userPreferred") or title.get("english") or "",
            "englishTitle": title.get("english"),
            "nativeTitle": title.get("native"),
            "preferredTitle": title.get("userPreferred"),
            "coverUrl": cover_url,
            "siteUrl": item.get("siteUrl"),
            "format": item.get("format"),
            "seasonYear": item.get("seasonYear"),
            "episodes": item.get("episodes"),
        })

    return results


def _safe_cover_name(value: str) -> str:
    value = str(value or "")
    value = re.sub(r"[^a-zA-Z0-9_.-]+", "_", value)
    value = value.strip("._-")

    return value or "cover"


def _extension_from_url(url: str) -> str:
    lower = url.lower().split("?", 1)[0]

    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        if lower.endswith(ext):
            return ext

    return ".jpg"


def download_cover_file(
    covers_dir: Path,
    series_id: int,
    source: str,
    external_id: str | int,
    cover_url: str,
) -> Path:
    covers_dir.mkdir(parents=True, exist_ok=True)

    source_part = _safe_cover_name(source)
    external_part = _safe_cover_name(str(external_id))
    ext = _extension_from_url(cover_url)

    filename = f"series_{series_id}_{source_part}_{external_part}{ext}"
    target_path = covers_dir / filename

    request = urllib.request.Request(
        cover_url,
        headers={
            "User-Agent": "Bunmine/1.0",
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
        method="GET",
    )

    with urllib.request.urlopen(request, timeout=20) as response:
        content_type = response.headers.get("Content-Type", "")
        data = response.read()

    if not content_type.startswith("image/"):
        raise ValueError(f"Cover URL did not return an image: {content_type}")

    if not data:
        raise ValueError("Downloaded cover is empty")

    target_path.write_bytes(data)

    return target_path.resolve()


def save_series_cover(
    db_path: Path,
    covers_dir: Path,
    series_id: int,
    source: str,
    external_id: str | int,
    cover_url: str,
) -> dict:
    cover_path = download_cover_file(
        covers_dir=covers_dir,
        series_id=series_id,
        source=source,
        external_id=external_id,
        cover_url=cover_url,
    )

    relative_path = str(cover_path.relative_to(covers_dir.parent))

    with get_db(db_path) as conn:
        series = conn.execute(
            """
            SELECT id
            FROM series
            WHERE id = ?
            """,
            (series_id,),
        ).fetchone()

        if not series:
            return {
                "found": False,
                "coverFileId": None,
            }

        row = conn.execute(
            """
            SELECT id
            FROM library_files
            WHERE path = ?
            """,
            (str(cover_path),),
        ).fetchone()

        if row:
            cover_file_id = int(row["id"])

            conn.execute(
                """
                UPDATE library_files
                SET
                    series_id = ?,
                    episode_id = NULL,
                    file_type = 'cover',
                    relative_path = ?,
                    file_exists = 1,
                    is_primary = 1,
                    missing_since = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (series_id, relative_path, cover_file_id),
            )
        else:
            cur = conn.execute(
                """
                INSERT INTO library_files(
                    series_id,
                    episode_id,
                    file_type,
                    path,
                    relative_path,
                    file_exists,
                    is_primary,
                    linked_at
                )
                VALUES(?, NULL, 'cover', ?, ?, 1, 1, CURRENT_TIMESTAMP)
                """,
                (series_id, str(cover_path), relative_path),
            )

            cover_file_id = int(cur.lastrowid)

        conn.execute(
            """
            UPDATE series
            SET
                cover_file_id = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (cover_file_id, series_id),
        )

    return {
        "found": True,
        "coverFileId": cover_file_id,
        "coverPath": str(cover_path),
    }


def get_series_cover_file(db_path: Path, series_id: int) -> dict:
    with get_db(db_path) as conn:
        row = conn.execute(
            """
            SELECT
                lf.id,
                lf.path,
                lf.relative_path,
                lf.file_exists
            FROM series s
            JOIN library_files lf ON lf.id = s.cover_file_id
            WHERE s.id = ?
              AND lf.file_type = 'cover'
            """,
            (series_id,),
        ).fetchone()

        if not row:
            return {
                "found": False,
                "file": None,
            }

        return {
            "found": True,
            "file": dict(row),
        }