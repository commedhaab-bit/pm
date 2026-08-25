import sqlite3

from app.db import connect, get_db_path, init_db, seed_if_empty


def test_creates_file_and_tables_when_absent(db_path):
    nested_path = db_path.parent / "nested" / "pm.db"
    assert not nested_path.exists()

    conn = connect(nested_path)
    init_db(conn)
    seed_if_empty(conn)
    conn.close()

    assert nested_path.is_file()

    check_conn = sqlite3.connect(nested_path)
    tables = {
        row[0]
        for row in check_conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    }
    check_conn.close()
    assert {"users", "boards"} <= tables


def test_seeding_is_idempotent_across_restarts(db_path):
    conn = connect(get_db_path())
    init_db(conn)
    seed_if_empty(conn)
    conn.close()

    conn = connect(get_db_path())
    init_db(conn)
    seed_if_empty(conn)
    user_count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    board_count = conn.execute("SELECT COUNT(*) FROM boards").fetchone()[0]
    conn.close()

    assert user_count == 1
    assert board_count == 1
