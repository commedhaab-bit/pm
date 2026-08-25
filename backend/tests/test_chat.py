import app.chat as chat_module
from app.chat import AIBoardData, AICard, AIColumn, ChatReply, load_history


def mock_ask_structured(monkeypatch, reply_obj):
    def fake(messages, response_model):
        return reply_obj

    monkeypatch.setattr(chat_module, "ask_structured", fake)


def login(client):
    response = client.post(
        "/api/login", json={"username": "user", "password": "password"}
    )
    assert response.status_code == 200


def test_chat_requires_auth(client):
    response = client.post("/api/chat", json={"message": "hi"})
    assert response.status_code == 401


def test_chat_reply_without_board_leaves_board_unchanged(client, monkeypatch):
    login(client)
    original_board = client.get("/api/board").json()

    mock_ask_structured(monkeypatch, ChatReply(reply="Hello there!", board=None))
    response = client.post("/api/chat", json={"message": "hi"})

    assert response.status_code == 200
    body = response.json()
    assert body["reply"] == "Hello there!"
    assert body["board"] is None
    assert client.get("/api/board").json() == original_board


def test_chat_reply_with_board_persists_it(client, monkeypatch):
    login(client)
    board = client.get("/api/board").json()

    new_board = AIBoardData(
        columns=[AIColumn(**c) for c in board["columns"]],
        cards=[AICard(**c) for c in board["cards"].values()],
    )
    # Move card-1 into col-done.
    for column in new_board.columns:
        if "card-1" in column.cardIds:
            column.cardIds.remove("card-1")
        if column.id == "col-done":
            column.cardIds.append("card-1")

    mock_ask_structured(
        monkeypatch, ChatReply(reply="Moved it to Done.", board=new_board)
    )
    response = client.post("/api/chat", json={"message": "move card-1 to done"})

    assert response.status_code == 200
    body = response.json()
    assert body["reply"] == "Moved it to Done."
    assert "card-1" in body["board"]["cards"]
    done_column = next(c for c in body["board"]["columns"] if c["id"] == "col-done")
    assert "card-1" in done_column["cardIds"]

    persisted = client.get("/api/board").json()
    persisted_done = next(c for c in persisted["columns"] if c["id"] == "col-done")
    assert "card-1" in persisted_done["cardIds"]


def test_chat_rejects_invalid_board_but_still_returns_reply(client, monkeypatch):
    login(client)
    original_board = client.get("/api/board").json()

    invalid_board = AIBoardData(
        columns=[
            AIColumn(id="col-backlog", title="Backlog", cardIds=["card-1"]),
        ],
        cards=[AICard(id="card-1", title="A", details="B")],
    )
    mock_ask_structured(
        monkeypatch, ChatReply(reply="Done!", board=invalid_board)
    )
    response = client.post("/api/chat", json={"message": "do something invalid"})

    assert response.status_code == 200
    body = response.json()
    assert body["reply"] == "Done!"
    assert body["board"] is None
    assert client.get("/api/board").json() == original_board


def test_chat_history_accumulates_and_truncates(client, monkeypatch, db_path):
    login(client)
    monkeypatch.setattr(chat_module, "MAX_HISTORY_MESSAGES", 4)

    for i in range(4):
        mock_ask_structured(monkeypatch, ChatReply(reply=f"reply {i}", board=None))
        response = client.post("/api/chat", json={"message": f"message {i}"})
        assert response.status_code == 200

    from app.db import connect, get_db_path

    conn = connect(get_db_path())
    row = conn.execute(
        "SELECT id FROM users WHERE username = 'user'"
    ).fetchone()
    history = load_history(conn, row["id"])
    conn.close()

    assert len(history) == 4
    assert history[-1] == {"role": "assistant", "content": "reply 3"}
    assert history[-2] == {"role": "user", "content": "message 3"}
