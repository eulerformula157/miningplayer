from backend.app import app
from backend.config import PORT

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=PORT)
