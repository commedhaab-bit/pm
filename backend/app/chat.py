import json
import sqlite3
from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ValidationError

from app.ai import ask_structured
from app.auth import CurrentUser, require_user
from app.board import COLUMN_IDS, BoardData, load_board, save_board
from app.db import get_db

router = APIRouter(prefix="/api")

MAX_HISTORY_MESSAGES = 20


# OpenAI's structured outputs (strict JSON schema) don't support dict/map-typed
# fields such as BoardData's `cards: dict[str, Card]` - every object must have a
# fixed set of properties. So the AI sees `cards` as a list here, each already
# carrying its own id, and _ai_board_to_board_data() converts that list into
# the dict-keyed BoardData shape everything else in the app uses.
class AICard(BaseModel):
    id: str
    title: str
    details: str


class AIColumn(BaseModel):
    id: str
    title: str
    cardIds: list[str]


class AIBoardData(BaseModel):
    columns: list[AIColumn]
    cards: list[AICard]


class ChatReply(BaseModel):
    reply: str
    board: AIBoardData | None = None


class ChatRequest(BaseModel):
    message: str


class ChatResponse(BaseModel):
    reply: str
    board: BoardData | None = None


def _ai_board_to_board_data(ai_board: AIBoardData) -> BoardData:
    card_ids = [card.id for card in ai_board.cards]
    if len(card_ids) != len(set(card_ids)):
        raise ValueError("duplicate card id in AI response")
    return BoardData(
        columns=[column.model_dump() for column in ai_board.columns],
        cards={card.id: card.model_dump() for card in ai_board.cards},
    )


def _system_prompt(board: BoardData) -> str:
    return (
        "You manage a Kanban board for the user.\n\n"
        "Rules:\n"
        f"- There are exactly five columns, with these fixed ids: "
        f"{', '.join(COLUMN_IDS)}. Never add, remove, or invent a column id - "
        "only a column's title may change.\n"
        "- Every card must belong to exactly one column's cardIds list; no card "
        "may be left out of every column or placed in more than one.\n"
        "- You may create, edit, delete, or move cards as the user asks.\n"
        '- Only set "board" in your response if you are changing the board; '
        "leave it null for a plain reply.\n"
        '- When you do set "board", return the COMPLETE board - every column '
        "and every card, not just the ones you changed.\n\n"
        f"Current board:\n{board.model_dump_json()}"
    )


def load_history(conn: sqlite3.Connection, user_id: int) -> list[dict[str, str]]:
    row = conn.execute(
        "SELECT messages FROM chat_history WHERE user_id = ?", (user_id,)
    ).fetchone()
    if row is None:
        return []
    return json.loads(row["messages"])


def save_history(
    conn: sqlite3.Connection, user_id: int, messages: list[dict[str, str]]
) -> None:
    now = datetime.now(UTC).isoformat()
    conn.execute(
        """
        INSERT INTO chat_history (user_id, messages, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE
            SET messages = excluded.messages, updated_at = excluded.updated_at
        """,
        (user_id, json.dumps(messages), now),
    )
    conn.commit()


@router.post("/chat")
def chat(
    payload: ChatRequest,
    current_user: CurrentUser = Depends(require_user),
    conn: sqlite3.Connection = Depends(get_db),
) -> ChatResponse:
    board = load_board(conn, current_user.id)
    history = load_history(conn, current_user.id)

    messages = [
        {"role": "system", "content": _system_prompt(board)},
        *history,
        {"role": "user", "content": payload.message},
    ]
    ai_reply = ask_structured(messages, ChatReply)

    updated_board: BoardData | None = None
    if ai_reply.board is not None:
        try:
            updated_board = _ai_board_to_board_data(ai_reply.board)
        except (ValidationError, ValueError):
            updated_board = None
        else:
            save_board(conn, current_user.id, updated_board)

    new_history = history + [
        {"role": "user", "content": payload.message},
        {"role": "assistant", "content": ai_reply.reply},
    ]
    save_history(conn, current_user.id, new_history[-MAX_HISTORY_MESSAGES:])

    return ChatResponse(reply=ai_reply.reply, board=updated_board)
