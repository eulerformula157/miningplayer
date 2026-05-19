import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


SCHEMA_VERSION = 2


@contextmanager
def get_db(db_path: Path) -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    try:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_library_db(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)

    with get_db(db_path) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS schema_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS series (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                normalized_title TEXT NOT NULL UNIQUE,
                sort_title TEXT,
                cover_file_id INTEGER,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_series_normalized_title
                ON series(normalized_title);

            CREATE TABLE IF NOT EXISTS episodes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                series_id INTEGER NOT NULL,
                episode_number REAL,
                season_number INTEGER,
                title TEXT,
                normalized_key TEXT NOT NULL UNIQUE,
                duration_seconds REAL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

                FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_episodes_series_id
                ON episodes(series_id);

            CREATE INDEX IF NOT EXISTS idx_episodes_normalized_key
                ON episodes(normalized_key);

            CREATE TABLE IF NOT EXISTS library_files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                series_id INTEGER,
                episode_id INTEGER,
                file_type TEXT NOT NULL,
                path TEXT NOT NULL UNIQUE,
                relative_path TEXT NOT NULL,
                file_exists INTEGER NOT NULL DEFAULT 1,
                is_primary INTEGER NOT NULL DEFAULT 0,
                linked_at TEXT,
                missing_since TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

                FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE SET NULL,
                FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE SET NULL
            );
            
            CREATE INDEX IF NOT EXISTS idx_library_files_series_id
                ON library_files(series_id);

            CREATE INDEX IF NOT EXISTS idx_library_files_episode_id
                ON library_files(episode_id);

            CREATE INDEX IF NOT EXISTS idx_library_files_file_type
                ON library_files(file_type);

            CREATE INDEX IF NOT EXISTS idx_library_files_file_exists
                ON library_files(file_exists);

            CREATE TABLE IF NOT EXISTS watch_progress (
                episode_id INTEGER PRIMARY KEY,
                current_time_seconds REAL NOT NULL DEFAULT 0,
                duration_seconds REAL,
                watched_seconds REAL NOT NULL DEFAULT 0,
                completed INTEGER NOT NULL DEFAULT 0,
                last_watched_at TEXT,

                FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_watch_progress_completed
                ON watch_progress(completed);

            CREATE TABLE IF NOT EXISTS cards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                series_id INTEGER,
                episode_id INTEGER,
                note_id TEXT NOT NULL UNIQUE,
                word TEXT,
                sentence TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

                FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE SET NULL,
                FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS idx_cards_series_id
                ON cards(series_id);

            CREATE INDEX IF NOT EXISTS idx_cards_episode_id
                ON cards(episode_id);

            CREATE INDEX IF NOT EXISTS idx_cards_note_id
                ON cards(note_id);
            """
        )

        conn.execute(
            """
            INSERT INTO schema_meta(key, value)
            VALUES('schema_version', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (str(SCHEMA_VERSION),),
        )


def get_library_db_status(db_path: Path) -> dict:
    exists = db_path.exists()

    status = {
        "path": str(db_path),
        "exists": exists,
        "schemaVersion": None,
        "tables": {},
    }

    if not exists:
        return status

    with get_db(db_path) as conn:
        row = conn.execute(
            "SELECT value FROM schema_meta WHERE key = 'schema_version'"
        ).fetchone()

        if row:
            status["schemaVersion"] = row["value"]

        table_names = [
            "series",
            "episodes",
            "library_files",
            "watch_progress",
            "cards",
        ]

        for table_name in table_names:
            count_row = conn.execute(
                f"SELECT COUNT(*) AS count FROM {table_name}"
            ).fetchone()

            status["tables"][table_name] = count_row["count"]

    return status
    
def get_library_series_debug(db_path: Path) -> list[dict]:
    with get_db(db_path) as conn:
        rows = conn.execute(
            """
            SELECT
                s.id,
                s.title,

                COUNT(DISTINCT e.id) AS episodes_count,

                COUNT(DISTINCT CASE
                    WHEN lf.file_type = 'video' THEN lf.id
                END) AS video_files_count,

                COUNT(DISTINCT CASE
                    WHEN lf.file_type = 'subtitle' THEN lf.id
                END) AS subtitle_files_count,

                COUNT(DISTINCT CASE
                    WHEN EXISTS (
                        SELECT 1
                        FROM library_files vf
                        WHERE vf.episode_id = e.id
                          AND vf.file_type = 'video'
                          AND vf.file_exists = 1
                    )
                    THEN e.id
                END) AS episodes_with_video,

                COUNT(DISTINCT CASE
                    WHEN EXISTS (
                        SELECT 1
                        FROM library_files sf
                        WHERE sf.episode_id = e.id
                          AND sf.file_type = 'subtitle'
                          AND sf.file_exists = 1
                    )
                    THEN e.id
                END) AS episodes_with_subtitle,

                COUNT(DISTINCT CASE
                    WHEN EXISTS (
                        SELECT 1
                        FROM library_files vf
                        WHERE vf.episode_id = e.id
                          AND vf.file_type = 'video'
                          AND vf.file_exists = 1
                    )
                    AND EXISTS (
                        SELECT 1
                        FROM library_files sf
                        WHERE sf.episode_id = e.id
                          AND sf.file_type = 'subtitle'
                          AND sf.file_exists = 1
                    )
                    THEN e.id
                END) AS episodes_with_video_and_subtitle,

                COUNT(DISTINCT CASE
                    WHEN EXISTS (
                        SELECT 1
                        FROM library_files vf
                        WHERE vf.episode_id = e.id
                          AND vf.file_type = 'video'
                          AND vf.file_exists = 1
                    )
                    AND NOT EXISTS (
                        SELECT 1
                        FROM library_files sf
                        WHERE sf.episode_id = e.id
                          AND sf.file_type = 'subtitle'
                          AND sf.file_exists = 1
                    )
                    THEN e.id
                END) AS episodes_video_only,

                COUNT(DISTINCT CASE
                    WHEN EXISTS (
                        SELECT 1
                        FROM library_files sf
                        WHERE sf.episode_id = e.id
                          AND sf.file_type = 'subtitle'
                          AND sf.file_exists = 1
                    )
                    AND NOT EXISTS (
                        SELECT 1
                        FROM library_files vf
                        WHERE vf.episode_id = e.id
                          AND vf.file_type = 'video'
                          AND vf.file_exists = 1
                    )
                    THEN e.id
                END) AS episodes_subtitle_only

            FROM series s
            LEFT JOIN episodes e ON e.series_id = s.id
            LEFT JOIN library_files lf ON lf.episode_id = e.id
            GROUP BY s.id, s.title
            ORDER BY s.sort_title, s.title
            """
        ).fetchall()

        return [dict(row) for row in rows]

def get_library_series_files_debug(db_path: Path, series_id: int) -> dict:
    with get_db(db_path) as conn:
        series = conn.execute(
            """
            SELECT id, title
            FROM series
            WHERE id = ?
            """,
            (series_id,),
        ).fetchone()

        if not series:
            return {
                "found": False,
                "series": None,
                "files": [],
            }

        rows = conn.execute(
            """
            SELECT
                lf.id AS file_id,
                lf.file_type,
                lf.relative_path,
                lf.file_exists,
                lf.is_primary,
                e.id AS episode_id,
                e.title AS episode_title,
                e.episode_number,
                e.season_number,
                e.normalized_key
            FROM library_files lf
            LEFT JOIN episodes e ON e.id = lf.episode_id
            WHERE lf.series_id = ?
            ORDER BY
                e.season_number,
                e.episode_number,
                lf.file_type,
                lf.relative_path
            """,
            (series_id,),
        ).fetchall()

        return {
            "found": True,
            "series": dict(series),
            "files": [dict(row) for row in rows],
        }
        
        
def _episode_link_status(has_video: bool, has_subtitle: bool) -> str:
    if has_video and has_subtitle:
        return "linked"

    if has_video or has_subtitle:
        return "partial"

    return "missing"


def _series_link_status(
    episodes_count: int,
    episodes_with_video: int,
    episodes_with_subtitle: int,
) -> str:
    if episodes_count <= 0:
        return "missing"

    if episodes_with_video <= 0 and episodes_with_subtitle <= 0:
        return "missing"

    if (
        episodes_with_video == episodes_count
        and episodes_with_subtitle == episodes_count
    ):
        return "linked"

    return "partial"


def get_library_series_list(db_path: Path) -> list[dict]:
    with get_db(db_path) as conn:
        rows = conn.execute(
            """
            SELECT
                s.id,
                s.title,
                s.cover_file_id,

                COUNT(DISTINCT e.id) AS episodes_count,

                COUNT(DISTINCT CASE
                    WHEN EXISTS (
                        SELECT 1
                        FROM library_files vf
                        WHERE vf.episode_id = e.id
                          AND vf.file_type = 'video'
                          AND vf.file_exists = 1
                    )
                    THEN e.id
                END) AS episodes_with_video,

                COUNT(DISTINCT CASE
                    WHEN EXISTS (
                        SELECT 1
                        FROM library_files sf
                        WHERE sf.episode_id = e.id
                          AND sf.file_type = 'subtitle'
                          AND sf.file_exists = 1
                    )
                    THEN e.id
                END) AS episodes_with_subtitle,

                COUNT(DISTINCT CASE
                    WHEN wp.completed = 1 THEN e.id
                END) AS completed_episodes,

                COALESCE(SUM(wp.watched_seconds), 0) AS watched_seconds,

                COUNT(DISTINCT c.id) AS cards_count,

                COUNT(DISTINCT CASE
                    WHEN c.word IS NOT NULL AND TRIM(c.word) != ''
                    THEN c.word
                END) AS mined_words_count

            FROM series s
            LEFT JOIN episodes e ON e.series_id = s.id
            LEFT JOIN watch_progress wp ON wp.episode_id = e.id
            LEFT JOIN cards c ON c.series_id = s.id
            GROUP BY s.id, s.title
            ORDER BY s.sort_title, s.title
            """
        ).fetchall()

        result = []

        for row in rows:
            episodes_count = int(row["episodes_count"])
            episodes_with_video = int(row["episodes_with_video"])
            episodes_with_subtitle = int(row["episodes_with_subtitle"])

            result.append({
                "id": row["id"],
                "title": row["title"],
                "coverUrl": f"/library/cover/{row['id']}" if row["cover_file_id"] else None,
                "episodesCount": episodes_count,
                "episodesWithVideo": episodes_with_video,
                "episodesWithSubtitle": episodes_with_subtitle,
                "completedEpisodes": int(row["completed_episodes"]),
                "watchedSeconds": float(row["watched_seconds"] or 0),
                "cardsCount": int(row["cards_count"]),
                "minedWordsCount": int(row["mined_words_count"]),
                "linkStatus": _series_link_status(
                    episodes_count,
                    episodes_with_video,
                    episodes_with_subtitle,
                ),
            })

        return result


def get_library_series_detail(db_path: Path, series_id: int) -> dict:
    with get_db(db_path) as conn:
        series_row = conn.execute(
            """
            SELECT id, title, cover_file_id
            FROM series
            WHERE id = ?
            """,
            (series_id,),
        ).fetchone()

        if not series_row:
            return {
                "found": False,
                "series": None,
                "episodes": [],
            }

        episode_rows = conn.execute(
            """
            SELECT
                e.id,
                e.title,
                e.episode_number,
                e.season_number,
                e.duration_seconds,

                EXISTS (
                    SELECT 1
                    FROM library_files vf
                    WHERE vf.episode_id = e.id
                      AND vf.file_type = 'video'
                      AND vf.file_exists = 1
                ) AS has_video,

                EXISTS (
                    SELECT 1
                    FROM library_files sf
                    WHERE sf.episode_id = e.id
                      AND sf.file_type = 'subtitle'
                      AND sf.file_exists = 1
                ) AS has_subtitle,

                (
                    SELECT vf.id
                    FROM library_files vf
                    WHERE vf.episode_id = e.id
                      AND vf.file_type = 'video'
                      AND vf.file_exists = 1
                    ORDER BY vf.is_primary DESC, vf.id ASC
                    LIMIT 1
                ) AS video_file_id,

                (
                    SELECT sf.id
                    FROM library_files sf
                    WHERE sf.episode_id = e.id
                      AND sf.file_type = 'subtitle'
                      AND sf.file_exists = 1
                    ORDER BY sf.is_primary DESC, sf.id ASC
                    LIMIT 1
                ) AS subtitle_file_id,

                COALESCE(wp.current_time_seconds, 0) AS current_time_seconds,
                COALESCE(wp.watched_seconds, 0) AS watched_seconds,
                COALESCE(wp.completed, 0) AS completed,

                COUNT(DISTINCT c.id) AS cards_count,

                COUNT(DISTINCT CASE
                    WHEN c.word IS NOT NULL AND TRIM(c.word) != ''
                    THEN c.word
                END) AS mined_words_count

            FROM episodes e
            LEFT JOIN watch_progress wp ON wp.episode_id = e.id
            LEFT JOIN cards c ON c.episode_id = e.id
            WHERE e.series_id = ?
            GROUP BY e.id
            ORDER BY
                COALESCE(e.season_number, 1),
                e.episode_number IS NULL,
                e.episode_number,
                e.title
            """,
            (series_id,),
        ).fetchall()

        episodes = []

        episodes_count = 0
        episodes_with_video = 0
        episodes_with_subtitle = 0

        for row in episode_rows:
            has_video = bool(row["has_video"])
            has_subtitle = bool(row["has_subtitle"])

            episodes_count += 1
            if has_video:
                episodes_with_video += 1
            if has_subtitle:
                episodes_with_subtitle += 1

            episodes.append({
                "id": row["id"],
                "title": row["title"],
                "episodeNumber": row["episode_number"],
                "seasonNumber": row["season_number"],
                "durationSeconds": row["duration_seconds"],
                "hasVideo": has_video,
                "hasSubtitle": has_subtitle,
                "videoFileId": row["video_file_id"],
                "subtitleFileId": row["subtitle_file_id"],
                "currentTimeSeconds": float(row["current_time_seconds"] or 0),
                "watchedSeconds": float(row["watched_seconds"] or 0),
                "completed": bool(row["completed"]),
                "cardsCount": int(row["cards_count"]),
                "minedWordsCount": int(row["mined_words_count"]),
                "linkStatus": _episode_link_status(has_video, has_subtitle),
            })

        series = {
            "id": series_row["id"],
            "title": series_row["title"],
            "coverUrl": f"/library/cover/{series_row['id']}" if series_row["cover_file_id"] else None,
            "episodesCount": episodes_count,
            "episodesWithVideo": episodes_with_video,
            "episodesWithSubtitle": episodes_with_subtitle,
            "linkStatus": _series_link_status(
                episodes_count,
                episodes_with_video,
                episodes_with_subtitle,
            ),
        }

        return {
            "found": True,
            "series": series,
            "episodes": episodes,
        }

def get_library_file_by_id(db_path: Path, file_id: int) -> dict:
    with get_db(db_path) as conn:
        row = conn.execute(
            """
            SELECT
                id,
                series_id,
                episode_id,
                file_type,
                path,
                relative_path,
                file_exists,
                is_primary
            FROM library_files
            WHERE id = ?
            """,
            (file_id,),
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


def get_episode_playback(db_path: Path, episode_id: int) -> dict:
    with get_db(db_path) as conn:
        row = conn.execute(
            """
            SELECT
                e.id AS episode_id,
                e.title AS episode_title,
                e.duration_seconds,
                s.id AS series_id,
                s.title AS series_title,

                COALESCE(wp.current_time_seconds, 0) AS current_time_seconds,

                (
                    SELECT vf.id
                    FROM library_files vf
                    WHERE vf.episode_id = e.id
                      AND vf.file_type = 'video'
                      AND vf.file_exists = 1
                    ORDER BY vf.is_primary DESC, vf.id ASC
                    LIMIT 1
                ) AS video_file_id,

                (
                    SELECT sf.id
                    FROM library_files sf
                    WHERE sf.episode_id = e.id
                      AND sf.file_type = 'subtitle'
                      AND sf.file_exists = 1
                    ORDER BY sf.is_primary DESC, sf.id ASC
                    LIMIT 1
                ) AS subtitle_file_id

            FROM episodes e
            JOIN series s ON s.id = e.series_id
            LEFT JOIN watch_progress wp ON wp.episode_id = e.id
            WHERE e.id = ?
            """,
            (episode_id,),
        ).fetchone()

        if not row:
            return {
                "found": False,
                "playback": None,
            }

        if not row["video_file_id"]:
            return {
                "found": True,
                "playback": None,
                "error": "Video file is missing for this episode",
            }

        subtitle_file_id = row["subtitle_file_id"]

        playback = {
            "episodeId": row["episode_id"],
            "seriesId": row["series_id"],
            "seriesTitle": row["series_title"],
            "episodeTitle": row["episode_title"],
            "durationSeconds": row["duration_seconds"],
            "currentTimeSeconds": float(row["current_time_seconds"] or 0),
            "videoFileId": row["video_file_id"],
            "subtitleFileId": subtitle_file_id,
            "videoUrl": f"/library/file/{row['video_file_id']}",
            "subtitleUrl": f"/library/file/{subtitle_file_id}" if subtitle_file_id else None,
        }

        return {
            "found": True,
            "playback": playback,
        }


def save_episode_progress(
    db_path: Path,
    episode_id: int,
    current_time_seconds: float,
    duration_seconds: float | None,
    watched_delta_seconds: float,
    completed: bool,
) -> dict:
    current_time_seconds = max(0.0, float(current_time_seconds or 0))
    watched_delta_seconds = max(0.0, float(watched_delta_seconds or 0))

    if duration_seconds is not None:
        duration_seconds = max(0.0, float(duration_seconds or 0))

    with get_db(db_path) as conn:
        episode = conn.execute(
            """
            SELECT id
            FROM episodes
            WHERE id = ?
            """,
            (episode_id,),
        ).fetchone()

        if not episode:
            return {
                "found": False,
                "progress": None,
            }

        conn.execute(
            """
            INSERT INTO watch_progress(
                episode_id,
                current_time_seconds,
                duration_seconds,
                watched_seconds,
                completed,
                last_watched_at
            )
            VALUES(?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(episode_id) DO UPDATE SET
                current_time_seconds = excluded.current_time_seconds,
                duration_seconds = COALESCE(excluded.duration_seconds, watch_progress.duration_seconds),
                watched_seconds = watch_progress.watched_seconds + excluded.watched_seconds,
                completed = CASE
                    WHEN excluded.completed = 1 THEN 1
                    ELSE watch_progress.completed
                END,
                last_watched_at = CURRENT_TIMESTAMP
            """,
            (
                episode_id,
                current_time_seconds,
                duration_seconds,
                watched_delta_seconds,
                1 if completed else 0,
            ),
        )

        row = conn.execute(
            """
            SELECT
                episode_id,
                current_time_seconds,
                duration_seconds,
                watched_seconds,
                completed,
                last_watched_at
            FROM watch_progress
            WHERE episode_id = ?
            """,
            (episode_id,),
        ).fetchone()

        return {
            "found": True,
            "progress": dict(row),
        }        