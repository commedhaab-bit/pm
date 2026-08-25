def test_me_requires_auth(client):
    response = client.get("/api/me")
    assert response.status_code == 401


def test_login_wrong_username(client):
    response = client.post(
        "/api/login", json={"username": "nope", "password": "password"}
    )
    assert response.status_code == 401


def test_login_wrong_password(client):
    response = client.post(
        "/api/login", json={"username": "user", "password": "nope"}
    )
    assert response.status_code == 401


def test_login_missing_fields(client):
    response = client.post("/api/login", json={"username": "user"})
    assert response.status_code == 422


def test_login_then_me_then_logout(client):
    login_response = client.post(
        "/api/login", json={"username": "user", "password": "password"}
    )
    assert login_response.status_code == 200
    assert login_response.json() == {"username": "user"}

    me_response = client.get("/api/me")
    assert me_response.status_code == 200
    assert me_response.json() == {"username": "user"}

    logout_response = client.post("/api/logout")
    assert logout_response.status_code == 200

    me_after_logout = client.get("/api/me")
    assert me_after_logout.status_code == 401
