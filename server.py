from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import os
import subprocess
import werkzeug.utils
import json
import time
from PIL import Image, ImageDraw, ImageFont
import textwrap
from pathlib import Path
import hashlib
import threading
from typing import Optional
import re
import html

from ffmpeg_service import run_subprocess

from library_db import (
    init_library_db,
    get_library_db_status,
    get_library_series_debug,
    get_library_series_files_debug,
    get_library_series_list,
    get_library_series_detail,
    get_library_file_by_id,
    get_episode_playback,
)

from library_scanner import scan_library

from config import (
    PLAYER_DIR,
    VIDEO_DIR,
    ANKI_HIGHLIGHT_CACHE_DIR,
    ANKI_MEDIA_DIR,
    SCREENSHOT_DIR,
    AUDIO_DIR,
    ALLOWED_ORIGIN,
    ALLOWED_VIDEO_EXTENSIONS,
    ALLOWED_SUBTITLE_EXTENSIONS,
    MEDIA_LIBRARY_DIR,
    DEDUPE_INDEX_PATH,
    LIBRARY_DB_PATH,
    PORT,
)

from utils_validation import (
    is_within,
    safe_uploaded_filename,
    safe_media_name,
    safe_cache_key,
    normalize_text,
    to_float,
)

os.makedirs(VIDEO_DIR, exist_ok=True)
os.makedirs(SCREENSHOT_DIR, exist_ok=True)
os.makedirs(ANKI_HIGHLIGHT_CACHE_DIR, exist_ok=True)

last_heartbeat = time.time()
dedupe_lock = threading.Lock()

# --- Flask ---
app = Flask(__name__, static_folder=str(PLAYER_DIR))
CORS(app, resources={r"/*": {"origins": [ALLOWED_ORIGIN]}})

   
def _clean_srt_text_file(path: Path) -> None:
    text = path.read_text(encoding="utf-8-sig", errors="replace")

    # Убираем HTML-подобные теги: <font ...>, </font>, <i>, </i> и т.д.
    text = re.sub(r"</?[^>\n]+>", "", text)

    # Раскодируем HTML-сущности, если попадутся: &amp; &lt; &gt;
    text = html.unescape(text)

    path.write_text(text, encoding="utf-8")

def _load_dedupe_index() -> dict:
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


def _save_dedupe_index(index_data: dict) -> None:
    DEDUPE_INDEX_PATH.write_text(
        json.dumps(index_data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _make_dedupe_key(kind: str, payload: dict) -> str:
    canonical = json.dumps(
        {"kind": kind, "payload": payload},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _get_cached_media(kind: str, dedupe_key: str) -> Optional[str]:
    with dedupe_lock:
        index_data = _load_dedupe_index()
        filename = index_data.get(kind, {}).get(dedupe_key)
    if not filename:
        return None

    base_dir = SCREENSHOT_DIR if kind == "screenshot" else AUDIO_DIR
    file_path = base_dir / filename
    if file_path.exists() and file_path.stat().st_size > 0:
        return filename
    return None


def _save_cached_media(kind: str, dedupe_key: str, filename: str) -> None:
    with dedupe_lock:
        index_data = _load_dedupe_index()
        index_data.setdefault(kind, {})
        index_data[kind][dedupe_key] = filename
        _save_dedupe_index(index_data)

def cleanup_on_startup():
    print("--- Очистка временных файлов ---")

    # Очищаем dedupe index при перезапуске сервера
    if DEDUPE_INDEX_PATH.exists():
        try:
            DEDUPE_INDEX_PATH.unlink()
            print(f"Удален dedupe index: {DEDUPE_INDEX_PATH}")
        except Exception as e:
            print(f"Не удалось удалить dedupe index: {e}")

    for f in os.listdir(VIDEO_DIR):
        f_path = os.path.join(VIDEO_DIR, f)
        # Удаляем все, что начинается на temp_ ИЛИ имеет расширение видео
        if f.startswith("temp_") or f.endswith(('.mp4', '.mkv', '.avi', '.mov', '.webm', '.srt', '.ass', '.vtt')):
            try:
                os.remove(f_path)
                print(f"Удален файл: {f}")
            except Exception as e:
                print(f"Не удалось удалить {f}: {e}")

# Вызываем функцию при запуске скрипта
cleanup_on_startup()
init_library_db(LIBRARY_DB_PATH)

# - библиотека просмотренных аниме

@app.route("/library/config", methods=["GET"])
def library_config():
    return jsonify({
        "mediaLibraryDir": str(MEDIA_LIBRARY_DIR),
        "exists": MEDIA_LIBRARY_DIR.exists(),
        "isDirectory": MEDIA_LIBRARY_DIR.is_dir(),
        "videoExtensions": sorted(ALLOWED_VIDEO_EXTENSIONS),
        "subtitleExtensions": sorted(ALLOWED_SUBTITLE_EXTENSIONS),
    })

@app.route("/library/db/status", methods=["GET"])
def library_db_status():
    return jsonify(get_library_db_status(LIBRARY_DB_PATH))

@app.route("/library/scan", methods=["GET"])
def library_scan():
    result = scan_library(
        db_path=LIBRARY_DB_PATH,
        media_root=MEDIA_LIBRARY_DIR,
        video_extensions=ALLOWED_VIDEO_EXTENSIONS,
        subtitle_extensions=ALLOWED_SUBTITLE_EXTENSIONS,
    )

    status_code = 200 if result.get("ok") else 400
    return jsonify(result), status_code

@app.route("/library/debug/series", methods=["GET"])
def library_debug_series():
    return jsonify({
        "series": get_library_series_debug(LIBRARY_DB_PATH)
    })
    
@app.route("/library/debug/series/<int:series_id>/files", methods=["GET"])
def library_debug_series_files(series_id):
    result = get_library_series_files_debug(LIBRARY_DB_PATH, series_id)
    status_code = 200 if result.get("found") else 404
    return jsonify(result), status_code

@app.route("/library/series", methods=["GET"])
def library_series_list():
    return jsonify({
        "series": get_library_series_list(LIBRARY_DB_PATH)
    })


@app.route("/library/series/<int:series_id>", methods=["GET"])
def library_series_detail(series_id):
    result = get_library_series_detail(LIBRARY_DB_PATH, series_id)
    status_code = 200 if result.get("found") else 404
    return jsonify(result), status_code

@app.route("/library/episodes/<int:episode_id>/playback", methods=["GET"])
def library_episode_playback(episode_id):
    result = get_episode_playback(LIBRARY_DB_PATH, episode_id)

    if not result.get("found"):
        return jsonify({
            "error": "Episode not found"
        }), 404

    if result.get("error"):
        return jsonify({
            "error": result["error"]
        }), 404

    return jsonify(result["playback"])


@app.route("/library/file/<int:file_id>", methods=["GET"])
def serve_library_file(file_id):
    result = get_library_file_by_id(LIBRARY_DB_PATH, file_id)

    if not result.get("found"):
        return jsonify({"error": "File not found"}), 404

    file_info = result["file"]
    file_path = Path(file_info["path"]).resolve()

    if not is_within(MEDIA_LIBRARY_DIR, file_path):
        return jsonify({"error": "File is outside MEDIA_LIBRARY_DIR"}), 403

    if not file_path.exists() or not file_path.is_file():
        return jsonify({"error": "File is missing"}), 404

    return send_from_directory(
        str(file_path.parent),
        file_path.name,
        as_attachment=False,
    )

def resolve_video_path_from_payload(data: dict) -> tuple[Optional[Path], Optional[dict], Optional[tuple]]:
    """
    Returns:
      (video_path, video_identity, error_response)

    video_identity is used for dedupe keys.
    error_response is (jsonify_payload, status_code).
    """
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

# --- Статические файлы ---
@app.route('/')
def index():
    return send_from_directory(str(PLAYER_DIR), 'player.html')

@app.route('/libs/kuromoji/dict/<path:filename>')
def serve_kuromoji_dict(filename):
    if not filename.endswith(".dat.gz"):
        return jsonify({"error": "Invalid dictionary file"}), 400

    dict_dir = PLAYER_DIR / "libs" / "kuromoji" / "dict"
    file_path = dict_dir / filename

    if not file_path.exists() or not is_within(dict_dir, file_path):
        return jsonify({"error": "Dictionary file not found"}), 404

    data = file_path.read_bytes()

    response = app.response_class(
        data,
        mimetype="application/octet-stream"
    )

    response.headers["Content-Type"] = "application/octet-stream"
    response.headers["Cache-Control"] = "no-store"
    response.headers.pop("Content-Encoding", None)

    return response

@app.route('/<path:path>')
def serve_file(path):
    return send_from_directory(str(PLAYER_DIR), path)

# --- Загрузка видео ---
@app.route('/upload-video', methods=['POST'])
def upload_video():
    file = request.files.get('videoFile')
    if not file:
        return jsonify({"error": "Файл не получен"}), 400

    try:
        filename = safe_uploaded_filename(
            file.filename,
            ALLOWED_VIDEO_EXTENSIONS
        )
    except ValueError as err:
        return jsonify({"error": str(err)}), 400

    save_path = os.path.join(VIDEO_DIR, filename)
    file.save(save_path)

    base_name = os.path.splitext(filename)[0]

    return jsonify({
        "filename": filename,
        "baseName": base_name
    })
    
@app.route('/upload-subtitle', methods=['POST'])
def upload_subtitle():
    subtitle_file = request.files.get('subtitleFile')
    video_filename = request.form.get('videoFilename')

    if not subtitle_file:
        return jsonify({"error": "Subtitle file is not received"}), 400

    if not video_filename:
        return jsonify({"error": "Video filename is required"}), 400

    try:
        safe_video_filename = safe_uploaded_filename(
            video_filename,
            ALLOWED_VIDEO_EXTENSIONS
        )
    except ValueError as err:
        return jsonify({"error": str(err)}), 400

    original_subtitle_name = subtitle_file.filename or ""
    subtitle_ext = os.path.splitext(original_subtitle_name)[1].lower()

    if subtitle_ext not in {".srt", ".ass"}:
        return jsonify({"error": "Only .srt and .ass subtitles are supported"}), 400

    video_base_name = os.path.splitext(safe_video_filename)[0]

    # На выходе всегда храним .srt
    srt_filename = f"{video_base_name}.srt"
    srt_path = VIDEO_DIR / srt_filename

    # Если уже SRT — просто сохраняем как .srt
    if subtitle_ext == ".srt":
        subtitle_file.save(srt_path)
        _clean_srt_text_file(srt_path)

        return jsonify({
            "filename": srt_filename
        })

    # Если ASS — сохраняем временно и конвертируем через ffmpeg
    temp_ass_filename = f"temp_{video_base_name}.ass"
    temp_ass_path = VIDEO_DIR / temp_ass_filename

    subtitle_file.save(temp_ass_path)

    cmd = [
        "ffmpeg",
        "-y",
        "-i", str(temp_ass_path),
        "-c:s", "srt",
        str(srt_path)
    ]

    try:
        run_subprocess(cmd)
        _clean_srt_text_file(srt_path)
    except RuntimeError as err:
        if srt_path.exists():
            srt_path.unlink()
        return jsonify({
            "error": f"FFmpeg subtitle conversion error: {str(err)}"
        }), 500
    finally:
        if temp_ass_path.exists():
            temp_ass_path.unlink()
            
    return jsonify({
    "filename": srt_filename
})        
    
@app.route("/current-video", methods=["GET"])
def current_video():
    video_extensions = {".mp4", ".mkv", ".webm", ".avi", ".mov"}
    subtitle_extensions = [".srt"]

    videos = [
        path for path in VIDEO_DIR.iterdir()
        if path.is_file() and path.suffix.lower() in video_extensions
    ]

    if not videos:
        return jsonify({
            "filename": None,
            "subtitleFilename": None
        })

    latest_video = max(videos, key=lambda path: path.stat().st_mtime)
    video_base_name = latest_video.stem

    subtitle_filename = None

    for ext in subtitle_extensions:
        candidate = VIDEO_DIR / f"{video_base_name}{ext}"
        if candidate.exists():
            subtitle_filename = candidate.name
            break

    return jsonify({
        "filename": latest_video.name,
        "subtitleFilename": subtitle_filename
    })

@app.route("/videos", methods=["GET"])
def list_videos():
    video_extensions = {".mp4", ".mkv", ".webm", ".avi", ".mov"}
    subtitle_extensions = [".srt"]

    videos = []

    for path in VIDEO_DIR.iterdir():
        if not path.is_file():
            continue

        if path.suffix.lower() not in video_extensions:
            continue

        subtitle_filename = None

        for ext in subtitle_extensions:
            candidate = VIDEO_DIR / f"{path.stem}{ext}"
            if candidate.exists():
                subtitle_filename = candidate.name
                break

        videos.append({
            "filename": path.name,
            "subtitleFilename": subtitle_filename,
            "modifiedTime": path.stat().st_mtime
        })

    videos.sort(key=lambda item: item["modifiedTime"], reverse=True)

    return jsonify({
        "videos": videos
    })

@app.route("/video/<path:filename>")
def serve_video(filename):
    return send_from_directory(str(VIDEO_DIR), filename)

@app.route("/subtitle/<path:filename>")
def serve_subtitle(filename):
    safe_name = os.path.basename(filename)
    subtitle_path = os.path.join(VIDEO_DIR, safe_name)

    if not os.path.exists(subtitle_path):
        return jsonify({"error": "Subtitle not found"}), 404

    ext = os.path.splitext(safe_name)[1].lower()

    if ext != ".srt":
        return jsonify({"error": "Invalid subtitle extension"}), 400

    return send_from_directory(str(VIDEO_DIR), safe_name)

# --- Создание скриншота ---
@app.route('/screenshot', methods=['POST'])
def screenshot():
    data = request.get_json(silent=True) or {}
    t_val = data.get('time')
    text = data.get('text', '').strip()
    font_size = int(2.0 * int(data.get('fontSize', 40)))

    if t_val is None:
        return jsonify({"error": "time is required"}), 400

    video_path_obj, video_identity, error_response = resolve_video_path_from_payload(data)
    if error_response:
        payload, status_code = error_response
        return jsonify(payload), status_code

    video_path = str(video_path_obj)
    raw_screenshot = os.path.join(VIDEO_DIR, "temp_raw.jpg")
    normalized_text = normalize_text(text)

    screenshot_payload = {
        "video": video_identity,
        "time": round(to_float(t_val), 3),
        "text": normalized_text,
        "fontSize": font_size,
    }
    screenshot_key = _make_dedupe_key("screenshot", screenshot_payload)
    cached_filename = _get_cached_media("screenshot", screenshot_key)
    if cached_filename:
        return jsonify({"filename": cached_filename, "reused": True})
    
    # 1. Создаем скриншот через FFmpeg
    cmd = ["ffmpeg", "-y", "-ss", str(t_val), "-i", video_path, "-vframes", "1", "-q:v", "2", raw_screenshot]
    try:
        run_subprocess(cmd)
    except RuntimeError as err:
        return jsonify({"error": f"FFmpeg screenshot error: {str(err)}"}), 500

    # 2. Обработка через Pillow
    img = Image.open(raw_screenshot)
    draw = ImageDraw.Draw(img)
    
    font_path = os.path.join(os.path.dirname(__file__), "fonts", "NotoSansJP-Bold.ttf")
    
    try:
        font = ImageFont.truetype(font_path, font_size)
    except Exception as e:
        print(f"Ошибка загрузки шрифта: {e}")
        font = ImageFont.load_default()
    
    # Разбиваем текст (width=25 обычно ок для японского, для русского можно чуть больше)
    lines = textwrap.wrap(text, width=15) 
    
    # Расчет позиции
    line_height = font_size + 15 # Немного увеличил межстрочный интервал для жирной обводки
    total_text_height = len(lines) * line_height
    y_text = img.height - total_text_height - 60 # Отступ снизу
    
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        text_width = bbox[2] - bbox[0]
        x = (img.width - text_width) / 2
        
        # РИСУЕМ ТЕКСТ С ЖИРНОЙ ОБВОДКОЙ
        draw.text(
            (x, y_text), 
            line, 
            font=font, 
            fill="white", 
            stroke_width=12,      # ТУТ регулируй жирность (5-7 обычно идеально)
            stroke_fill="black"  # Цвет обводки
        )
        y_text += line_height

    # Сохранение (путь берется из C:\Users\Dima\AppData\Roaming\Anki2\...)
    screenshot_filename = f"screenshot_{screenshot_key[:24]}.jpg"
    final_path = os.path.join(SCREENSHOT_DIR, screenshot_filename)
    img.save(final_path)
    _save_cached_media("screenshot", screenshot_key, screenshot_filename)
    
    if os.path.exists(raw_screenshot):
        os.remove(raw_screenshot)

    return jsonify({"filename": screenshot_filename, "reused": False})

# --- Создание WEBP анимации ---
@app.route('/animated-webp', methods=['POST'])
def animated_webp():
    data = request.get_json(silent=True) or {}
    start = data.get('start')
    end = data.get('end')
    text = data.get('text', '').strip()
    font_size = int(3.0 * int(data.get('fontSize', 40)))

    if start is None or end is None:
        return jsonify({"error": "start and end are required"}), 400

    video_path_obj, video_identity, error_response = resolve_video_path_from_payload(data)
    if error_response:
        payload, status_code = error_response
        return jsonify(payload), status_code

    video_path = str(video_path_obj)

    start_f = round(to_float(start), 3)
    end_f = round(to_float(end), 3)

    if end_f <= start_f:
        end_f = start_f + 0.5

    # Защита от слишком больших файлов
    duration = min(end_f - start_f, 8.0)

    normalized_text = normalize_text(text)

    webp_payload = {
        "video": video_identity,
        "start": start_f,
        "duration": round(duration, 3),
        "text": normalized_text,
        "fontSize": font_size,
    }

    webp_key = _make_dedupe_key("screenshot", webp_payload)
    cached_filename = _get_cached_media("screenshot", webp_key)

    if cached_filename:
        return jsonify({"filename": cached_filename, "reused": True})

    webp_filename = f"webp_{webp_key[:24]}.webp"
    final_path = os.path.join(SCREENSHOT_DIR, webp_filename)

    ass_path = os.path.join(VIDEO_DIR, f"temp_{webp_key[:12]}.ass")

    # Экранируем текст для ASS
    ass_text = text.replace("\\", "\\\\")
    ass_text = ass_text.replace("{", "\\{").replace("}", "\\}")
    ass_text = ass_text.replace("\n", "\\N")

    # Формат времени ASS
    duration_ass = f"0:00:{duration:05.2f}"

    ass_content = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Noto Sans JP,{font_size},&H00FFFFFF,&H00000000,1,12,0,2,40,40,90,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,{duration_ass},Default,,0,0,0,,{ass_text}
"""

    Path(ass_path).write_text(ass_content, encoding="utf-8")

    # Для Windows FFmpeg-фильтр любит forward slashes
    ass_filter_path = ass_path.replace("\\", "/").replace(":", "\\:")
    fonts_dir = os.path.join(os.path.dirname(__file__), "fonts")
    fonts_dir_filter = fonts_dir.replace("\\", "/").replace(":", "\\:")

    cmd = [
        "ffmpeg", "-y",
        "-ss", str(start_f),
        "-t", str(duration),
        "-i", video_path,
        "-vf", f"subtitles='{ass_filter_path}':fontsdir='{fonts_dir_filter}',scale=480:-2:flags=lanczos,fps=10",
        "-c:v", "libwebp",
        "-lossless", "0",
        "-quality", "70",
        "-compression_level", "6",
        "-preset", "picture",
        "-loop", "0",
        "-an",
        final_path
    ]

    try:
        run_subprocess(cmd)
        _save_cached_media("screenshot", webp_key, webp_filename)
    except RuntimeError as err:
        return jsonify({"error": f"FFmpeg WebP error: {str(err)}"}), 500
    finally:
        if os.path.exists(ass_path):
            os.remove(ass_path)

    return jsonify({"filename": webp_filename, "reused": False})

# --- Создание аудио ---
@app.route('/audio-to-anki', methods=['POST'])
def audio():
    data = request.get_json(silent=True) or {}
    start = data.get("start")
    end = data.get("end")
    track_index = data.get("trackIndex", "a:0")
    volume_level = data.get("volume", "1")

    if start is None or end is None:
        return jsonify({"error": "start and end are required"}), 400

    video_path_obj, video_identity, error_response = resolve_video_path_from_payload(data)
    if error_response:
        payload, status_code = error_response
        return jsonify(payload), status_code

    video_path = str(video_path_obj)
    start_f = round(to_float(start), 3)
    end_f = round(to_float(end), 3)
    volume_f = round(to_float(volume_level, 1.0), 3)
    track_str = str(track_index)

    audio_payload = {
        "video": video_identity,
        "start": start_f,
        "end": end_f,
        "trackIndex": track_str,
        "volume": volume_f,
    }
    audio_key = _make_dedupe_key("audio", audio_payload)
    cached_filename = _get_cached_media("audio", audio_key)
    if cached_filename:
        return jsonify({
            "filename": cached_filename,
            "url": f"/get-temp-audio?filename={cached_filename}",
            "reused": True,
        })

    audio_filename = f"audio_{audio_key[:24]}.mp3"
    audio_path = os.path.join(AUDIO_DIR, audio_filename)

    # ВОТ ЗДЕСЬ ВОЗВРАЩАЕМ ЛОГИКУ ВЫБОРА ДОРОЖКИ
    # Если track_index это число (например 1), FFmpeg поймет это как -map 0:1
    # Если это строка типа "a:0", он поймет её как -map 0:a:0
    cmd = [
            "ffmpeg", "-y", "-i", video_path,
            "-ss", str(start_f), "-to", str(end_f),
            "-map", f"0:{track_str}",
            "-af", f"volume={volume_f}", # Используем полученную громкость
            "-vn", "-acodec", "libmp3lame",
            audio_path
        ]
    
    try:
        run_subprocess(cmd)
        _save_cached_media("audio", audio_key, audio_filename)
        return jsonify({
            "filename": audio_filename,
            "url": f"/get-temp-audio?filename={audio_filename}",
            "reused": False,
        })
    except RuntimeError as err:
        return jsonify({"error": f"FFmpeg audio error: {str(err)}"}), 500

@app.route('/get-temp-audio')
def get_temp_audio():
    filename = request.args.get("filename")
    try:
        safe_name = safe_media_name(filename)
    except ValueError as err:
        return jsonify({"error": str(err)}), 400

    file_path = AUDIO_DIR / safe_name
    if not file_path.exists() or not is_within(AUDIO_DIR, file_path):
        return jsonify({"error": "Файл не найден"}), 404
    return send_from_directory(str(AUDIO_DIR), safe_name, mimetype='audio/mpeg')

@app.route('/get-audio-tracks', methods=['GET'])
def get_audio_tracks():
    video_file_id = request.args.get("videoFileId")
    filename = request.args.get("filename")

    if video_file_id:
        try:
            file_id = int(video_file_id)
        except (TypeError, ValueError):
            return jsonify({"error": "Invalid videoFileId"}), 400

        result = get_library_file_by_id(LIBRARY_DB_PATH, file_id)

        if not result.get("found"):
            return jsonify({"error": "Library video file not found"}), 404

        file_info = result["file"]

        if file_info.get("file_type") != "video":
            return jsonify({"error": "Library file is not a video"}), 400

        video_path_obj = Path(file_info["path"]).resolve()

        if not is_within(MEDIA_LIBRARY_DIR, video_path_obj):
            return jsonify({"error": "Video file is outside MEDIA_LIBRARY_DIR"}), 403

        if not video_path_obj.exists() or not video_path_obj.is_file():
            return jsonify({"error": "Video file is missing"}), 404

        video_path = str(video_path_obj)

    else:
        if not filename:
            return jsonify({"error": "filename or videoFileId is required"}), 400

        try:
            safe_filename = safe_media_name(filename)
        except ValueError as err:
            return jsonify({"error": str(err)}), 400

        video_path_obj = (VIDEO_DIR / safe_filename).resolve()

        if not video_path_obj.exists() or not is_within(VIDEO_DIR, video_path_obj):
            return jsonify({"error": f"Файл {filename} не найден по пути {video_path_obj}"}), 404

        video_path = str(video_path_obj)

    cmd = [
        "ffprobe", "-v", "error", "-select_streams", "a",
        "-show_entries", "stream=index:stream_tags=language,title",
        "-of", "json", video_path
    ]

    try:
        result = run_subprocess(cmd)
        data = json.loads(result.stdout)
        tracks = data.get("streams", [])
        return jsonify({"tracks": tracks})
    except Exception as e:
        print(f"Ошибка FFprobe: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/get-track-url', methods=['POST'])
def get_track_url():
    data = request.get_json(silent=True) or {}
    track_index = data.get("trackIndex")

    if track_index is None:
        return jsonify({"error": "trackIndex is required"}), 400

    video_path_obj, video_identity, error_response = resolve_video_path_from_payload(data)
    if error_response:
        payload, status_code = error_response
        return jsonify(payload), status_code

    video_path = str(video_path_obj)

    track_key = _make_dedupe_key("track", {
        "video": video_identity,
        "trackIndex": str(track_index),
    })

    temp_audio_name = f"temp_track_{track_key[:24]}.mka"
    temp_audio_path = os.path.join(VIDEO_DIR, temp_audio_name)

    if not os.path.exists(temp_audio_path):
        cmd = [
            "ffmpeg", "-y", "-i", video_path,
            "-map", f"0:{track_index}", "-c", "copy", temp_audio_path
        ]
        try:
            run_subprocess(cmd)
        except RuntimeError as err:
            return jsonify({"error": f"FFmpeg track extraction error: {str(err)}"}), 500

    # Возвращаем путь, по которому клиент сможет забрать файл
    return jsonify({"url": f"/download-audio?name={temp_audio_name}"})

@app.route('/download-audio')
def download_audio():
    name = request.args.get("name")
    try:
        safe_name = safe_media_name(name)
    except ValueError as err:
        return jsonify({"error": str(err)}), 400
    return send_from_directory(str(VIDEO_DIR), safe_name)

@app.route('/delete-video', methods=['DELETE'])
def delete_video():
    filename = request.args.get("filename")
    if not filename:
        return jsonify({"error":"filename не указан"}), 400
    
    try:
        safe_filename = safe_media_name(filename)
    except ValueError as err:
        return jsonify({"error": str(err)}), 400

    video_path = os.path.join(VIDEO_DIR, safe_filename)
    if os.path.exists(video_path):
        os.remove(video_path)

    # Удаляем связанный .srt
    video_base_name = os.path.splitext(safe_filename)[0]
    subtitle_path = os.path.join(VIDEO_DIR, f"{video_base_name}.srt")
    if os.path.exists(subtitle_path):
        os.remove(subtitle_path)
    
    # Удаляем временные аудиофайлы
    for f in os.listdir(VIDEO_DIR):
        if f.startswith("temp_") and safe_filename in f:
            try:
                os.remove(os.path.join(VIDEO_DIR, f))
            except:
                pass
                
    return jsonify({"success": True})

@app.route('/heartbeat', methods=['POST'])
def heartbeat():
    global last_heartbeat
    last_heartbeat = time.time()
    return jsonify({"status": "alive"})

#def monitor_activity():
#    while True:
#        # Если прошло больше 10 секунд без сигнала
#        if time.time() - last_heartbeat > 10:
#            os._exit(0) 
#        time.sleep(2)

# Запускаем поток мониторинга перед app.run()
#threading.Thread(target=monitor_activity, daemon=True).start()

def _safe_cache_key(raw_key: str) -> str:
    key = "".join(ch for ch in str(raw_key or "") if ch.isalnum() or ch in ("-", "_"))
    if not key:
        raise ValueError("Некорректный cache key")
    return key


@app.route("/anki-highlight-cache/<cache_key>", methods=["GET"])
def get_anki_highlight_cache(cache_key):
    try:
        safe_key = _safe_cache_key(cache_key)
    except ValueError as err:
        return jsonify({"error": str(err)}), 400

    cache_path = ANKI_HIGHLIGHT_CACHE_DIR / f"{safe_key}.json"

    if not cache_path.exists():
        return jsonify({"found": False})

    try:
        data = json.loads(cache_path.read_text(encoding="utf-8"))
        return jsonify({"found": True, "data": data})
    except Exception as err:
        return jsonify({"error": str(err)}), 500


@app.route("/anki-highlight-cache/<cache_key>", methods=["POST"])
def save_anki_highlight_cache(cache_key):
    try:
        safe_key = _safe_cache_key(cache_key)
    except ValueError as err:
        return jsonify({"error": str(err)}), 400

    data = request.get_json()
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid cache payload"}), 400

    cache_path = ANKI_HIGHLIGHT_CACHE_DIR / f"{safe_key}.json"
    cache_path.write_text(
        json.dumps(data, ensure_ascii=False),
        encoding="utf-8"
    )

    return jsonify({"success": True})


@app.route("/known-basic-words", methods=["GET"])
def get_known_basic_words():
    words_path = PLAYER_DIR / "known-basic-words.json"

    if not words_path.exists():
        return jsonify({
            "words": [],
            "source": str(words_path),
            "exists": False
        })

    try:
        data = json.loads(words_path.read_text(encoding="utf-8"))

        if isinstance(data, list):
            return jsonify({
                "words": data,
                "source": str(words_path),
                "exists": True
            })

        if isinstance(data, dict) and isinstance(data.get("words"), list):
            return jsonify({
                "words": data["words"],
                "source": str(words_path),
                "exists": True
            })

        return jsonify({
            "error": "Invalid known-basic-words.json format"
        }), 400

    except Exception as err:
        return jsonify({
            "error": str(err)
        }), 500

@app.route("/known-basic-words/add", methods=["POST"])
def add_known_basic_word():
    words_path = PLAYER_DIR / "known-basic-words.json"

    data = request.get_json(silent=True) or {}
    raw_word = data.get("word", "")

    word = str(raw_word).strip()

    if not word:
        return jsonify({"error": "Word is required"}), 400

    if len(word) > 80:
        return jsonify({"error": "Word is too long"}), 400

    try:
        if words_path.exists():
            current_data = json.loads(words_path.read_text(encoding="utf-8"))

            if isinstance(current_data, list):
                words = current_data
            elif isinstance(current_data, dict) and isinstance(current_data.get("words"), list):
                words = current_data["words"]
            else:
                return jsonify({"error": "Invalid known-basic-words.json format"}), 400
        else:
            words = []

        normalized_words = [str(item).strip() for item in words if str(item).strip()]

        if word not in normalized_words:
            normalized_words.append(word)

            words_path.write_text(
                json.dumps(normalized_words, ensure_ascii=False, indent=2),
                encoding="utf-8"
            )

            return jsonify({
                "ok": True,
                "word": word,
                "added": True,
                "count": len(normalized_words)
            })

        return jsonify({
            "ok": True,
            "word": word,
            "added": False,
            "count": len(normalized_words)
        })

    except Exception as err:
        return jsonify({"error": str(err)}), 500

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=PORT)

