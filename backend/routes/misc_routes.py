import json
import time

from flask import Blueprint, jsonify, request

from backend import app_state
from backend.config import ANKI_HIGHLIGHT_CACHE_DIR, PLAYER_DIR
from backend.utils_validation import safe_cache_key

misc_bp = Blueprint("misc", __name__)


@misc_bp.route("/heartbeat", methods=["POST"])
def heartbeat():
    app_state.last_heartbeat = time.time()
    return jsonify({"status": "alive"})


@misc_bp.route("/anki-highlight-cache/<cache_key>", methods=["GET"])
def get_anki_highlight_cache(cache_key):
    try:
        safe_key = safe_cache_key(cache_key)
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


@misc_bp.route("/anki-highlight-cache/<cache_key>", methods=["POST"])
def save_anki_highlight_cache(cache_key):
    try:
        safe_key = safe_cache_key(cache_key)
    except ValueError as err:
        return jsonify({"error": str(err)}), 400

    data = request.get_json()
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid cache payload"}), 400

    cache_path = ANKI_HIGHLIGHT_CACHE_DIR / f"{safe_key}.json"
    cache_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return jsonify({"success": True})


@misc_bp.route("/known-basic-words", methods=["GET"])
def get_known_basic_words():
    words_path = PLAYER_DIR / "known-basic-words.json"
    if not words_path.exists():
        return jsonify({"words": [], "source": str(words_path), "exists": False})

    try:
        data = json.loads(words_path.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return jsonify({"words": data, "source": str(words_path), "exists": True})
        if isinstance(data, dict) and isinstance(data.get("words"), list):
            return jsonify({"words": data["words"], "source": str(words_path), "exists": True})
        return jsonify({"error": "Invalid known-basic-words.json format"}), 400
    except Exception as err:
        return jsonify({"error": str(err)}), 500


@misc_bp.route("/known-basic-words/add", methods=["POST"])
def add_known_basic_word():
    words_path = PLAYER_DIR / "known-basic-words.json"
    data = request.get_json(silent=True) or {}
    word = str(data.get("word", "")).strip()
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
            words_path.write_text(json.dumps(normalized_words, ensure_ascii=False, indent=2), encoding="utf-8")
            return jsonify({"ok": True, "word": word, "added": True, "count": len(normalized_words)})

        return jsonify({"ok": True, "word": word, "added": False, "count": len(normalized_words)})
    except Exception as err:
        return jsonify({"error": str(err)}), 500

