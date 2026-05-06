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


# --- Lightweight .env loader ---
def _load_env_file(path: Path) -> None:
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


_load_env_file(Path(__file__).resolve().parent / ".env")

# --- Настройки директорий ---
DEFAULT_BASE_DIR = Path(__file__).resolve().parent
BASE_DIR = Path(os.getenv("PLAYER_SERVER_BASE_DIR", str(DEFAULT_BASE_DIR))).resolve()
PLAYER_DIR = BASE_DIR / "Player"
VIDEO_DIR = BASE_DIR / "UploadedVideos"

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

os.makedirs(VIDEO_DIR, exist_ok=True)
os.makedirs(SCREENSHOT_DIR, exist_ok=True)

last_heartbeat = time.time()
dedupe_lock = threading.Lock()

# --- Flask ---
app = Flask(__name__, static_folder=str(PLAYER_DIR))
CORS(app, resources={r"/*": {"origins": [ALLOWED_ORIGIN]}})


def _is_within(base: Path, target: Path) -> bool:
    try:
        target.resolve().relative_to(base.resolve())
        return True
    except ValueError:
        return False


def _safe_uploaded_filename(raw_filename: str) -> str:
    filename = werkzeug.utils.secure_filename(raw_filename or "")
    if not filename:
        raise ValueError("Некорректное имя файла")
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_VIDEO_EXTENSIONS:
        raise ValueError(f"Неподдерживаемый формат видео: {ext}")
    return filename


def _safe_media_name(raw_name: str) -> str:
    name = os.path.basename(raw_name or "")
    if not name or name != raw_name:
        raise ValueError("Некорректное имя файла")
    return name


def _normalize_text(value: str) -> str:
    return " ".join((value or "").strip().split())


def _to_float(value, fallback=0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback

def _run_subprocess(cmd: list[str]) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True
        )
    except FileNotFoundError:
        raise RuntimeError(
            "FFmpeg/FFprobe is not installed or not available in PATH."
        )
    except subprocess.CalledProcessError as err:
        details = err.stderr.strip() if err.stderr else str(err)
        raise RuntimeError(details)

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
        if f.startswith("temp_") or f.endswith(('.mp4', '.mkv', '.avi', '.mov', '.webm')):
            try:
                os.remove(f_path)
                print(f"Удален файл: {f}")
            except Exception as e:
                print(f"Не удалось удалить {f}: {e}")

# Вызываем функцию при запуске скрипта
cleanup_on_startup()


# --- Статические файлы ---
@app.route('/')
def index():
    return send_from_directory(str(PLAYER_DIR), 'player.html')

@app.route('/<path:path>')
def serve_file(path):
    return send_from_directory(str(PLAYER_DIR), path)

# --- Загрузка видео ---
@app.route('/upload-video', methods=['POST'])
def upload_video():
    file = request.files.get('videoFile')
    if not file:
        return jsonify({"error":"Файл не получен"}), 400

    # безопасное имя файла
    try:
        filename = _safe_uploaded_filename(file.filename)
    except ValueError as err:
        return jsonify({"error": str(err)}), 400

    save_path = os.path.join(VIDEO_DIR, filename)
    file.save(save_path)

    return jsonify({"filename": filename})

# --- Создание скриншота ---
@app.route('/screenshot', methods=['POST'])
def screenshot():
    data = request.get_json()
    filename = data.get('filename')
    t_val = data.get('time')
    text = data.get('text', '').strip()
    # Увеличиваем базовый размер шрифта для лучшей читаемости
    font_size = int(2.0 * int(data.get('fontSize', 40)))

    if not filename or t_val is None:
        return jsonify({"error":"Параметры не указаны"}), 400

    try:
        safe_filename = _safe_media_name(filename)
    except ValueError as err:
        return jsonify({"error": str(err)}), 400

    video_path = os.path.join(VIDEO_DIR, safe_filename)
    raw_screenshot = os.path.join(VIDEO_DIR, "temp_raw.jpg")
    normalized_text = _normalize_text(text)

    screenshot_payload = {
        "filename": safe_filename,
        "time": round(_to_float(t_val), 3),
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
        _run_subprocess(cmd)
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
    data = request.get_json()
    filename = data.get('filename')
    start = data.get('start')
    end = data.get('end')
    text = data.get('text', '').strip()
    font_size = int(3.0 * int(data.get('fontSize', 40)))

    if not filename or start is None or end is None:
        return jsonify({"error": "Параметры не указаны"}), 400

    try:
        safe_filename = _safe_media_name(filename)
    except ValueError as err:
        return jsonify({"error": str(err)}), 400

    video_path = os.path.join(VIDEO_DIR, safe_filename)

    start_f = round(_to_float(start), 3)
    end_f = round(_to_float(end), 3)

    if end_f <= start_f:
        end_f = start_f + 0.5

    # Защита от слишком больших файлов
    duration = min(end_f - start_f, 8.0)

    normalized_text = _normalize_text(text)

    webp_payload = {
        "filename": safe_filename,
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
        _run_subprocess(cmd)
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
    data = request.get_json()
    filename = data.get("filename")
    start = data.get("start")
    end = data.get("end")
    # Возвращаем индекс, переданный из фронтенда (например, "a:0" или "1")
    track_index = data.get("trackIndex", "a:0") 
    
    volume_level = data.get("volume", "1") # Берем из запроса, по умолчанию 1

    if not filename or start is None or end is None:
        return jsonify({"error":"Неверные параметры"}), 400

    try:
        safe_filename = _safe_media_name(filename)
    except ValueError as err:
        return jsonify({"error": str(err)}), 400

    video_path = os.path.join(VIDEO_DIR, safe_filename)
    start_f = round(_to_float(start), 3)
    end_f = round(_to_float(end), 3)
    volume_f = round(_to_float(volume_level, 1.0), 3)
    track_str = str(track_index)

    audio_payload = {
        "filename": safe_filename,
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
        _run_subprocess(cmd)
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
        safe_name = _safe_media_name(filename)
    except ValueError as err:
        return jsonify({"error": str(err)}), 400

    file_path = AUDIO_DIR / safe_name
    if not file_path.exists() or not _is_within(AUDIO_DIR, file_path):
        return jsonify({"error": "Файл не найден"}), 404
    return send_from_directory(str(AUDIO_DIR), safe_name, mimetype='audio/mpeg')

@app.route('/get-audio-tracks', methods=['GET'])
def get_audio_tracks():
    filename = request.args.get("filename")
    if not filename:
        return jsonify({"error": "filename не указан"}), 400
    
    # ВАЖНО: используем os.path.join(VIDEO_DIR, filename)
    try:
        safe_filename = _safe_media_name(filename)
    except ValueError as err:
        return jsonify({"error": str(err)}), 400

    video_path = os.path.join(VIDEO_DIR, safe_filename)
    
    if not os.path.exists(video_path):
        return jsonify({"error": f"Файл {filename} не найден по пути {video_path}"}), 404

    cmd = [
        "ffprobe", "-v", "error", "-select_streams", "a",
        "-show_entries", "stream=index:stream_tags=language,title",
        "-of", "json", video_path
    ]
    
    try:
        result = _run_subprocess(cmd)
        # Если ffprobe ничего не нашел, result.stdout может быть пустым
        data = json.loads(result.stdout)
        tracks = data.get("streams", [])
        return jsonify({"tracks": tracks})
    except Exception as e:
        print(f"Ошибка FFprobe: {e}") # Это появится в консоли Python
        return jsonify({"error": str(e)}), 500

@app.route('/get-track-url', methods=['POST'])
def get_track_url():
    data = request.get_json()
    filename = data.get("filename")
    track_index = data.get("trackIndex") # это индекс из ffprobe (например, 1)

    try:
        safe_filename = _safe_media_name(filename)
    except ValueError as err:
        return jsonify({"error": str(err)}), 400

    video_path = os.path.join(VIDEO_DIR, safe_filename)
    # Создаем временный аудиофайл для этой дорожки
    temp_audio_name = f"temp_{track_index}_{safe_filename}.mka"
    temp_audio_path = os.path.join(VIDEO_DIR, temp_audio_name)

    if not os.path.exists(temp_audio_path):
        cmd = [
            "ffmpeg", "-y", "-i", video_path,
            "-map", f"0:{track_index}", "-c", "copy", temp_audio_path
        ]
        try:
            _run_subprocess(cmd)
        except RuntimeError as err:
            return jsonify({"error": f"FFmpeg track extraction error: {str(err)}"}), 500

    # Возвращаем путь, по которому клиент сможет забрать файл
    return jsonify({"url": f"/download-audio?name={temp_audio_name}"})

@app.route('/download-audio')
def download_audio():
    name = request.args.get("name")
    try:
        safe_name = _safe_media_name(name)
    except ValueError as err:
        return jsonify({"error": str(err)}), 400
    return send_from_directory(str(VIDEO_DIR), safe_name)

@app.route('/delete-video', methods=['DELETE'])
def delete_video():
    filename = request.args.get("filename")
    if not filename:
        return jsonify({"error":"filename не указан"}), 400
    
    # 1. Удаляем видео
    try:
        safe_filename = _safe_media_name(filename)
    except ValueError as err:
        return jsonify({"error": str(err)}), 400

    video_path = os.path.join(VIDEO_DIR, safe_filename)
    if os.path.exists(video_path):
        os.remove(video_path)
    
    # 2. Удаляем все связанные временные аудиофайлы (начинающиеся на temp_ и содержащие имя файла)
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

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.getenv("PORT", "5000")))