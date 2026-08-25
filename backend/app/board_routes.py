import sqlite3

from fastapi import APIRouter, Depends

from app.auth import CurrentUser, require_user
from app.board import BoardData, load_board, save_board
from app.db import get_db

router = APIRouter(prefix="/api")


@router.get("/board")
def get_board(
    current_user: CurrentUser = Depends(require_user),
    conn: sqlite3.Connection = Depends(get_db),
) -> BoardData:
    return load_board(conn, current_user.id)


@router.put("/board")
def put_board(
    board: BoardData,
    current_user: CurrentUser = Depends(require_user),
    conn: sqlite3.Connection = Depends(get_db),
) -> BoardData:
    save_board(conn, current_user.id, board)
    return board
