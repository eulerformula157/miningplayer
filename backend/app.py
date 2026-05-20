from flask import Flask
from flask_cors import CORS

from backend.config import ALLOWED_ORIGIN, PLAYER_DIR

from backend.routes.library_routes import library_bp
from backend.routes.media_routes import media_bp
from backend.routes.misc_routes import misc_bp
from backend.routes.static_routes import static_bp
from backend.services.startup_service import initialize_backend


def create_app() -> Flask:
    initialize_backend()
    app = Flask(__name__, static_folder=str(PLAYER_DIR))
    CORS(app, resources={r"/*": {"origins": [ALLOWED_ORIGIN]}})

    app.register_blueprint(library_bp)
    app.register_blueprint(media_bp)
    app.register_blueprint(misc_bp)
    app.register_blueprint(static_bp)
    return app


app = create_app()

