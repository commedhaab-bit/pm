import json
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app.auth import hash_password
from app.board import COLUMN_IDS
from app.db import connect, get_db_path
from app.main import app


def login(client, username="user", password="password"):
    response = client.post("/api/login", json={"username": username, "password": password})
    assert response.status_code == 200
    return response


def valid_board(card_id: str = "card-1") -> dict:
    return {
        "columns": [
            {"id": column_id, "title": column_id, "cardIds": [card_id] if column_id == COLUMN_IDS[0] else []}
            for column_id in COLUMN_IDS
        ],
        "cards": {card_id: {"id": card_id, "title": "A card", "details": "Some details"}},
    }


def test_get_board_requires_auth(client):
    response = client.get("/api/board")
    assert response.status_code == 401


def test_put_board_requires_auth(client):
    response = client.put("/api/board", json=valid_board())
    assert response.status_code == 401


def test_get_board_returns_seeded_board(client):
    login(client)
    response = client.get("/api/board")
    assert response.status_code == 200
    body = response.json()
    assert {c["id"] for c in body["columns"]} == set(COLUMN_IDS)
    assert len(body["cards"]) == 8


def test_put_board_persists_and_get_reflects_it(client):
    login(client)
    board = valid_board("card-solo")
    put_response = client.put("/api/board", json=board)
    assert put_response.status_code == 200

    get_response = client.get("/api/board")
    assert get_response.status_code == 200
    assert get_response.json()["cards"] == board["cards"]


@pytest.mark.parametrize(
    "mutate",
    [
        pytest.param(
            lambda b: b["columns"].pop(),
            id="wrong-column-count",
        ),
        pytest.param(
            lambda b: b["columns"][0]["cardIds"].append("no-such-card"),
            id="unknown-card-id",
        ),
        pytest.param(
            lambda b: b["columns"][1]["cardIds"].append(b["columns"][0]["cardIds"][0]),
            id="duplicate-card-across-columns",
        ),
        pytest.param(
            lambda b: b["cards"].update(
                {"orphan": {"id": "orphan", "title": "x", "details": "y"}}
            ),
            id="orphaned-card",
        ),
        pytest.param(
            lambda b: b["columns"].__setitem__(
                0, {**b["columns"][0], "id": "col-renamed"}
            ),
            id="renamed-column-id",
        ),
    ],
)
def test_put_board_rejects_invalid_shapes(client, mutate):
    login(client)
    board = valid_board()
    mutate(board)
    response = client.put("/api/board", json=board)
    assert response.status_code == 422


def test_two_users_see_only_their_own_board(client, db_path):
    login(client)

    conn = connect(get_db_path())
    now = datetime.now(UTC).isoformat()
    cursor = conn.execute(
        "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
        ("user2", hash_password("password2"), now),
    )
    user2_id = cursor.lastrowid
    other_board = valid_board("card-other")
    conn.execute(
        "INSERT INTO boards (user_id, data, updated_at) VALUES (?, ?, ?)",
        (user2_id, json.dumps(other_board), now),
    )
    conn.commit()
    conn.close()

    client2 = TestClient(app)
    login(client2, "user2", "password2")

    board1 = client.get("/api/board").json()
    board2 = client2.get("/api/board").json()

    assert "card-other" not in board1["cards"]
    assert "card-other" in board2["cards"]
    assert len(board1["cards"]) == 8

    client.put("/api/board", json=valid_board("card-changed"))
    board2_after = client2.get("/api/board").json()
    assert board2_after == other_board
