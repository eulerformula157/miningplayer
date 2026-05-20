from flask import Blueprint, current_app, jsonify, send_from_directory

from backend.config import PLAYER_DIR
from backend.utils_validation import is_within

static_bp = Blueprint("static", __name__)


@static_bp.route("/")
def index():
    return send_from_directory(str(PLAYER_DIR), "player.html")


@static_bp.route("/library-page")
def library_page():
    return send_from_directory(str(PLAYER_DIR), "library.html")


@static_bp.route("/libs/kuromoji/dict/<path:filename>")
def serve_kuromoji_dict(filename):
    if not filename.endswith(".dat.gz"):
        return jsonify({"error": "Invalid dictionary file"}), 400

    dict_dir = PLAYER_DIR / "libs" / "kuromoji" / "dict"
    file_path = dict_dir / filename
    if not file_path.exists() or not is_within(dict_dir, file_path):
        return jsonify({"error": "Dictionary file not found"}), 404

    data = file_path.read_bytes()
    response = current_app.response_class(data, mimetype="application/octet-stream")
    response.headers["Content-Type"] = "application/octet-stream"
    response.headers["Cache-Control"] = "no-store"
    response.headers.pop("Content-Encoding", None)
    return response


@static_bp.route("/<path:path>")
def serve_file(path):
    return send_from_directory(str(PLAYER_DIR), path)

