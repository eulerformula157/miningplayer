import json
import os
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from flask import Blueprint, jsonify, request, send_from_directory

from backend.config import (
    ALLOWED_VIDEO_EXTENSIONS,
    AUDIO_DIR,
    BASE_DIR,
    LIBRARY_DB_PATH,
    MEDIA_LIBRARY_DIR,
    SCREENSHOT_DIR,
    VIDEO_DIR,
)
from backend.ffmpeg_service import run_subprocess
from backend.library_db import get_library_file_by_id
from backend.utils_validation import is_within, normalize_text, safe_media_name, safe_uploaded_filename, to_float

from backend.services.dedupe_service import (
    clean_srt_text_file,
    get_cached_media,
    make_dedupe_key,
    save_cached_media,
)
from backend.services.video_service import resolve_video_path_from_payload

media_bp = Blueprint("media", __name__)


@media_bp.route("/upload-video", methods=["POST"])
def upload_video():
    file = request.files.get("videoFile")
    if not file:
        return jsonify({"error": "Файл не получен"}), 400
    try:
        filename = safe_uploaded_filename(file.filename, ALLOWED_VIDEO_EXTENSIONS)
    except ValueError as err:
        return jsonify({"error": str(err)}), 400

    save_path = os.path.join(VIDEO_DIR, filename)
    file.save(save_path)
    return jsonify({"filename": filename, "baseName": os.path.splitext(filename)[0]})


@media_bp.route("/upload-subtitle", methods=["POST"])
def upload_subtitle():
    subtitle_file = request.files.get("subtitleFile")
    video_filename = request.form.get("videoFilename")

    if not subtitle_file:
        return jsonify({"error": "Subtitle file is not received"}), 400
    if not video_filename:
        return jsonify({"error": "Video filename is required"}), 400

    try:
        safe_video_filename = safe_uploaded_filename(video_filename, ALLOWED_VIDEO_EXTENSIONS)
    except ValueError as err:
        return jsonify({"error": str(err)}), 400

    subtitle_ext = os.path.splitext(subtitle_file.filename or "")[1].lower()
    if subtitle_ext not in {".srt", ".ass"}:
        return jsonify({"error": "Only .srt and .ass subtitles are supported"}), 400

    video_base_name = os.path.splitext(safe_video_filename)[0]
    srt_filename = f"{video_base_name}.srt"
    srt_path = VIDEO_DIR / srt_filename

    if subtitle_ext == ".srt":
        subtitle_file.save(srt_path)
        clean_srt_text_file(srt_path)
        return jsonify({"filename": srt_filename})

    temp_ass_path = VIDEO_DIR / f"temp_{video_base_name}.ass"
    subtitle_file.save(temp_ass_path)
    cmd = ["ffmpeg", "-y", "-i", str(temp_ass_path), "-c:s", "srt", str(srt_path)]
    try:
        run_subprocess(cmd)
        clean_srt_text_file(srt_path)
    except RuntimeError as err:
        if srt_path.exists():
            srt_path.unlink()
        return jsonify({"error": f"FFmpeg subtitle conversion error: {str(err)}"}), 500
    finally:
        if temp_ass_path.exists():
            temp_ass_path.unlink()
    return jsonify({"filename": srt_filename})


@media_bp.route("/current-video", methods=["GET"])
def current_video():
    videos = [path for path in VIDEO_DIR.iterdir() if path.is_file() and path.suffix.lower() in ALLOWED_VIDEO_EXTENSIONS]
    if not videos:
        return jsonify({"filename": None, "subtitleFilename": None})

    latest_video = max(videos, key=lambda path: path.stat().st_mtime)
    subtitle_filename = None
    candidate = VIDEO_DIR / f"{latest_video.stem}.srt"
    if candidate.exists():
        subtitle_filename = candidate.name
    return jsonify({"filename": latest_video.name, "subtitleFilename": subtitle_filename})


@media_bp.route("/videos", methods=["GET"])
def list_videos():
    videos = []
    for path in VIDEO_DIR.iterdir():
        if not path.is_file() or path.suffix.lower() not in ALLOWED_VIDEO_EXTENSIONS:
            continue
        subtitle_candidate = VIDEO_DIR / f"{path.stem}.srt"
        videos.append({
            "filename": path.name,
            "subtitleFilename": subtitle_candidate.name if subtitle_candidate.exists() else None,
            "modifiedTime": path.stat().st_mtime,
        })
    videos.sort(key=lambda item: item["modifiedTime"], reverse=True)
    return jsonify({"videos": videos})


@media_bp.route("/video/<path:filename>")
def serve_video(filename):
    return send_from_directory(str(VIDEO_DIR), filename)


@media_bp.route("/subtitle/<path:filename>")
def serve_subtitle(filename):
    safe_name = os.path.basename(filename)
    subtitle_path = os.path.join(VIDEO_DIR, safe_name)
    if not os.path.exists(subtitle_path):
        return jsonify({"error": "Subtitle not found"}), 404
    if os.path.splitext(safe_name)[1].lower() != ".srt":
        return jsonify({"error": "Invalid subtitle extension"}), 400
    return send_from_directory(str(VIDEO_DIR), safe_name)


@media_bp.route("/screenshot", methods=["POST"])
def screenshot():
    data = request.get_json(silent=True) or {}
    t_val = data.get("time")
    text = data.get("text", "").strip()
    font_size = int(2.0 * int(data.get("fontSize", 40)))
    if t_val is None:
        return jsonify({"error": "time is required"}), 400

    video_path_obj, video_identity, error_response = resolve_video_path_from_payload(data)
    if error_response:
        payload, status_code = error_response
        return jsonify(payload), status_code

    raw_screenshot = os.path.join(VIDEO_DIR, "temp_raw.jpg")
    screenshot_payload = {
        "video": video_identity,
        "time": round(to_float(t_val), 3),
        "text": normalize_text(text),
        "fontSize": font_size,
    }
    screenshot_key = make_dedupe_key("screenshot", screenshot_payload)
    cached_filename = get_cached_media("screenshot", screenshot_key)
    if cached_filename:
        return jsonify({"filename": cached_filename, "reused": True})

    cmd = ["ffmpeg", "-y", "-ss", str(t_val), "-i", str(video_path_obj), "-vframes", "1", "-q:v", "2", raw_screenshot]
    try:
        run_subprocess(cmd)
    except RuntimeError as err:
        return jsonify({"error": f"FFmpeg screenshot error: {str(err)}"}), 500

    img = Image.open(raw_screenshot)
    draw = ImageDraw.Draw(img)
    font_path = BASE_DIR / "fonts" / "NotoSansJP-Bold.ttf"
    try:
        font = ImageFont.truetype(str(font_path), font_size)
    except Exception:
        font = ImageFont.load_default()

    lines = textwrap.wrap(text, width=15)
    line_height = font_size + 15
    y_text = img.height - (len(lines) * line_height) - 60
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        x = (img.width - (bbox[2] - bbox[0])) / 2
        draw.text((x, y_text), line, font=font, fill="white", stroke_width=12, stroke_fill="black")
        y_text += line_height

    screenshot_filename = f"screenshot_{screenshot_key[:24]}.jpg"
    final_path = os.path.join(SCREENSHOT_DIR, screenshot_filename)
    img.save(final_path)
    save_cached_media("screenshot", screenshot_key, screenshot_filename)
    if os.path.exists(raw_screenshot):
        os.remove(raw_screenshot)
    return jsonify({"filename": screenshot_filename, "reused": False})


@media_bp.route("/animated-webp", methods=["POST"])
def animated_webp():
    data = request.get_json(silent=True) or {}
    start = data.get("start")
    end = data.get("end")
    text = data.get("text", "").strip()
    font_size = int(3.0 * int(data.get("fontSize", 40)))
    if start is None or end is None:
        return jsonify({"error": "start and end are required"}), 400

    video_path_obj, video_identity, error_response = resolve_video_path_from_payload(data)
    if error_response:
        payload, status_code = error_response
        return jsonify(payload), status_code

    start_f = round(to_float(start), 3)
    end_f = round(to_float(end), 3)
    if end_f <= start_f:
        end_f = start_f + 0.5
    duration = min(end_f - start_f, 8.0)

    webp_payload = {
        "video": video_identity,
        "start": start_f,
        "duration": round(duration, 3),
        "text": normalize_text(text),
        "fontSize": font_size,
    }
    webp_key = make_dedupe_key("screenshot", webp_payload)
    cached_filename = get_cached_media("screenshot", webp_key)
    if cached_filename:
        return jsonify({"filename": cached_filename, "reused": True})

    webp_filename = f"webp_{webp_key[:24]}.webp"
    final_path = os.path.join(SCREENSHOT_DIR, webp_filename)
    ass_path = os.path.join(VIDEO_DIR, f"temp_{webp_key[:12]}.ass")

    ass_text = text.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}").replace("\n", "\\N")
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

    ass_filter_path = ass_path.replace("\\", "/").replace(":", "\\:")
    fonts_dir_filter = str(BASE_DIR / "fonts").replace("\\", "/").replace(":", "\\:")
    cmd = [
        "ffmpeg", "-y", "-ss", str(start_f), "-t", str(duration), "-i", str(video_path_obj),
        "-vf", f"subtitles='{ass_filter_path}':fontsdir='{fonts_dir_filter}',scale=480:-2:flags=lanczos,fps=10",
        "-c:v", "libwebp", "-lossless", "0", "-quality", "70", "-compression_level", "6", "-preset", "picture",
        "-loop", "0", "-an", final_path,
    ]
    try:
        run_subprocess(cmd)
        save_cached_media("screenshot", webp_key, webp_filename)
    except RuntimeError as err:
        return jsonify({"error": f"FFmpeg WebP error: {str(err)}"}), 500
    finally:
        if os.path.exists(ass_path):
            os.remove(ass_path)
    return jsonify({"filename": webp_filename, "reused": False})


@media_bp.route("/audio-to-anki", methods=["POST"])
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
    audio_key = make_dedupe_key("audio", audio_payload)
    cached_filename = get_cached_media("audio", audio_key)
    if cached_filename:
        return jsonify({"filename": cached_filename, "url": f"/get-temp-audio?filename={cached_filename}", "reused": True})

    audio_filename = f"audio_{audio_key[:24]}.mp3"
    audio_path = os.path.join(AUDIO_DIR, audio_filename)
    cmd = [
        "ffmpeg", "-y", "-i", str(video_path_obj), "-ss", str(start_f), "-to", str(end_f), "-map", f"0:{track_str}",
        "-af", f"volume={volume_f}", "-vn", "-acodec", "libmp3lame", audio_path,
    ]
    try:
        run_subprocess(cmd)
        save_cached_media("audio", audio_key, audio_filename)
        return jsonify({"filename": audio_filename, "url": f"/get-temp-audio?filename={audio_filename}", "reused": False})
    except RuntimeError as err:
        return jsonify({"error": f"FFmpeg audio error: {str(err)}"}), 500


@media_bp.route("/get-temp-audio")
def get_temp_audio():
    filename = request.args.get("filename")
    try:
        safe_name = safe_media_name(filename)
    except ValueError as err:
        return jsonify({"error": str(err)}), 400
    file_path = AUDIO_DIR / safe_name
    if not file_path.exists() or not is_within(AUDIO_DIR, file_path):
        return jsonify({"error": "Файл не найден"}), 404
    return send_from_directory(str(AUDIO_DIR), safe_name, mimetype="audio/mpeg")


@media_bp.route("/get-audio-tracks", methods=["GET"])
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

    cmd = ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index:stream_tags=language,title", "-of", "json", str(video_path_obj)]
    try:
        result = run_subprocess(cmd)
        data = json.loads(result.stdout)
        return jsonify({"tracks": data.get("streams", [])})
    except Exception as err:
        return jsonify({"error": str(err)}), 500


@media_bp.route("/get-track-url", methods=["POST"])
def get_track_url():
    data = request.get_json(silent=True) or {}
    track_index = data.get("trackIndex")
    if track_index is None:
        return jsonify({"error": "trackIndex is required"}), 400

    video_path_obj, video_identity, error_response = resolve_video_path_from_payload(data)
    if error_response:
        payload, status_code = error_response
        return jsonify(payload), status_code

    track_key = make_dedupe_key("track", {"video": video_identity, "trackIndex": str(track_index)})
    temp_audio_name = f"temp_track_{track_key[:24]}.mka"
    temp_audio_path = os.path.join(VIDEO_DIR, temp_audio_name)
    if not os.path.exists(temp_audio_path):
        cmd = ["ffmpeg", "-y", "-i", str(video_path_obj), "-map", f"0:{track_index}", "-c", "copy", temp_audio_path]
        try:
            run_subprocess(cmd)
        except RuntimeError as err:
            return jsonify({"error": f"FFmpeg track extraction error: {str(err)}"}), 500
    return jsonify({"url": f"/download-audio?name={temp_audio_name}"})


@media_bp.route("/download-audio")
def download_audio():
    name = request.args.get("name")
    try:
        safe_name = safe_media_name(name)
    except ValueError as err:
        return jsonify({"error": str(err)}), 400
    return send_from_directory(str(VIDEO_DIR), safe_name)


@media_bp.route("/delete-video", methods=["DELETE"])
def delete_video():
    filename = request.args.get("filename")
    if not filename:
        return jsonify({"error": "filename не указан"}), 400
    try:
        safe_filename = safe_media_name(filename)
    except ValueError as err:
        return jsonify({"error": str(err)}), 400

    video_path = os.path.join(VIDEO_DIR, safe_filename)
    if os.path.exists(video_path):
        os.remove(video_path)
    subtitle_path = os.path.join(VIDEO_DIR, f"{os.path.splitext(safe_filename)[0]}.srt")
    if os.path.exists(subtitle_path):
        os.remove(subtitle_path)

    for item in os.listdir(VIDEO_DIR):
        if item.startswith("temp_") and safe_filename in item:
            try:
                os.remove(os.path.join(VIDEO_DIR, item))
            except Exception:
                pass
    return jsonify({"success": True})

