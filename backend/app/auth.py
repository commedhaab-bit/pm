import hashlib
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.db import get_db

router = APIRouter(prefix="/api")


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def check_credentials(conn: sqlite3.Connection, username: str, password: str) -> bool:
    row = conn.execute(
        "SELECT password_hash FROM users WHERE username = ?", (username,)
    ).fetchone()
    if row is None:
        return False
    return row["password_hash"] == hash_password(password)


class CurrentUser(BaseModel):
    id: int
    username: str


def require_user(
    request: Request, conn: sqlite3.Connection = Depends(get_db)
) -> CurrentUser:
    username = request.session.get("username")
    if not username:
        raise HTTPException(status_code=401, detail="Not authenticated")

    row = conn.execute(
        "SELECT id, username FROM users WHERE username = ?", (username,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    return CurrentUser(id=row["id"], username=row["username"])


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
def login(
    payload: LoginRequest, request: Request, conn: sqlite3.Connection = Depends(get_db)
) -> dict[str, str]:
    if not check_credentials(conn, payload.username, payload.password):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    request.session["username"] = payload.username
    return {"username": payload.username}


@router.post("/logout")
def logout(request: Request) -> dict[str, str]:
    request.session.clear()
    return {"status": "ok"}


@router.get("/me")
def me(current_user: CurrentUser = Depends(require_user)) -> dict[str, str]:
    return {"username": current_user.username}
