import os
import sqlite3
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

from app.board import INITIAL_BOARD

HARDCODED_USERNAME = "user"
HARDCODED_PASSWORD = "password"


def get_db_path() -> Path:
    return Path(os.environ.get("DATABASE_PATH", "/data/pm.db"))


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    # check_same_thread=False: FastAPI runs sync dependencies and route handlers
    # via a thread pool, so a single request's get_db() setup and its handler
    # body are not guaranteed to run on the same thread. Each request still
    # opens and closes its own connection - none are shared across requests.
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS boards (
            id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
            data TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.commit()


def seed_if_empty(conn: sqlite3.Connection) -> None:
    from app.auth import hash_password

    count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    if count > 0:
        return

    now = datetime.now(UTC).isoformat()
    cursor = conn.execute(
        "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
        (HARDCODED_USERNAME, hash_password(HARDCODED_PASSWORD), now),
    )
    user_id = cursor.lastrowid
    conn.execute(
        "INSERT INTO boards (user_id, data, updated_at) VALUES (?, ?, ?)",
        (user_id, INITIAL_BOARD.model_dump_json(), now),
    )
    conn.commit()


_ready_paths: set[Path] = set()


def get_db() -> Iterator[sqlite3.Connection]:
    path = get_db_path()
    conn = connect(path)
    try:
        if path not in _ready_paths:
            init_db(conn)
            seed_if_empty(conn)
            _ready_paths.add(path)
        yield conn
    finally:
        conn.close()
