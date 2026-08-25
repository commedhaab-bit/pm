from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

HARDCODED_USERNAME = "user"
HARDCODED_PASSWORD = "password"

router = APIRouter(prefix="/api")


def check_credentials(username: str, password: str) -> bool:
    return username == HARDCODED_USERNAME and password == HARDCODED_PASSWORD


def require_user(request: Request) -> str:
    username = request.session.get("username")
    if not username:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return username


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
def login(payload: LoginRequest, request: Request) -> dict[str, str]:
    if not check_credentials(payload.username, payload.password):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    request.session["username"] = payload.username
    return {"username": payload.username}


@router.post("/logout")
def logout(request: Request) -> dict[str, str]:
    request.session.clear()
    return {"status": "ok"}


@router.get("/me")
def me(username: str = Depends(require_user)) -> dict[str, str]:
    return {"username": username}
