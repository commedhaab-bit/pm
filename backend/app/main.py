from fastapi import APIRouter, FastAPI

from app.static import mount_static

app = FastAPI(title="PM Backend")

api = APIRouter(prefix="/api")


@api.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(api)
mount_static(app)
