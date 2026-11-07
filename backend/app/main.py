"""Local Uvicorn compatibility entrypoint; staging imports the pure factory."""
from app.factory import create_app

app = create_app()
