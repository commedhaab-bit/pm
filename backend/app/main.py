import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI
from starlette.middleware.sessions import SessionMiddleware

from app.auth import router as auth_router
from app.static import mount_static

load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

app = FastAPI(title="PM Backend")

app.add_middleware(
    SessionMiddleware,
    secret_key=os.environ.get("SESSION_SECRET", "insecure-dev-secret"),
)

api = APIRouter(prefix="/api")


@api.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(api)
app.include_router(auth_router)
mount_static(app)
