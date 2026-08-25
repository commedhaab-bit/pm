import pytest


def login(client):
    response = client.post(
        "/api/login", json={"username": "user", "password": "password"}
    )
    assert response.status_code == 200


@pytest.mark.live
def test_chat_moves_first_backlog_card_to_done(client):
    login(client)
    board = client.get("/api/board").json()
    backlog = next(c for c in board["columns"] if c["id"] == "col-backlog")
    first_card_id = backlog["cardIds"][0]

    response = client.post(
        "/api/chat",
        json={
            "message": (
                "Move the first card in the Backlog column to the Done column."
            )
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["board"] is not None
    done = next(c for c in body["board"]["columns"] if c["id"] == "col-done")
    assert first_card_id in done["cardIds"]
