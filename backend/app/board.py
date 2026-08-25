import json
import sqlite3
from datetime import UTC, datetime

from pydantic import BaseModel, model_validator

COLUMN_IDS = ["col-backlog", "col-discovery", "col-progress", "col-review", "col-done"]


class Card(BaseModel):
    id: str
    title: str
    details: str


class Column(BaseModel):
    id: str
    title: str
    cardIds: list[str]


class BoardData(BaseModel):
    columns: list[Column]
    cards: dict[str, Card]

    @model_validator(mode="after")
    def check_invariants(self) -> "BoardData":
        column_ids = {column.id for column in self.columns}
        if column_ids != set(COLUMN_IDS):
            raise ValueError(
                f"columns must have exactly the ids {COLUMN_IDS}, got {sorted(column_ids)}"
            )

        placed_card_ids: set[str] = set()
        for column in self.columns:
            for card_id in column.cardIds:
                if card_id not in self.cards:
                    raise ValueError(
                        f"card '{card_id}' in column '{column.id}' is not in cards"
                    )
                if card_id in placed_card_ids:
                    raise ValueError(f"card '{card_id}' appears in more than one column")
                placed_card_ids.add(card_id)

        orphaned = self.cards.keys() - placed_card_ids
        if orphaned:
            raise ValueError(f"cards not placed in any column: {sorted(orphaned)}")

        return self


INITIAL_BOARD = BoardData(
    columns=[
        {"id": "col-backlog", "title": "Backlog", "cardIds": ["card-1", "card-2"]},
        {"id": "col-discovery", "title": "Discovery", "cardIds": ["card-3"]},
        {
            "id": "col-progress",
            "title": "In Progress",
            "cardIds": ["card-4", "card-5"],
        },
        {"id": "col-review", "title": "Review", "cardIds": ["card-6"]},
        {"id": "col-done", "title": "Done", "cardIds": ["card-7", "card-8"]},
    ],
    cards={
        "card-1": {
            "id": "card-1",
            "title": "Align roadmap themes",
            "details": "Draft quarterly themes with impact statements and metrics.",
        },
        "card-2": {
            "id": "card-2",
            "title": "Gather customer signals",
            "details": "Review support tags, sales notes, and churn feedback.",
        },
        "card-3": {
            "id": "card-3",
            "title": "Prototype analytics view",
            "details": "Sketch initial dashboard layout and key drill-downs.",
        },
        "card-4": {
            "id": "card-4",
            "title": "Refine status language",
            "details": "Standardize column labels and tone across the board.",
        },
        "card-5": {
            "id": "card-5",
            "title": "Design card layout",
            "details": "Add hierarchy and spacing for scanning dense lists.",
        },
        "card-6": {
            "id": "card-6",
            "title": "QA micro-interactions",
            "details": "Verify hover, focus, and loading states.",
        },
        "card-7": {
            "id": "card-7",
            "title": "Ship marketing page",
            "details": "Final copy approved and asset pack delivered.",
        },
        "card-8": {
            "id": "card-8",
            "title": "Close onboarding sprint",
            "details": "Document release notes and share internally.",
        },
    },
)


def load_board(conn: sqlite3.Connection, user_id: int) -> BoardData:
    row = conn.execute(
        "SELECT data FROM boards WHERE user_id = ?", (user_id,)
    ).fetchone()
    if row is None:
        raise LookupError(f"no board for user_id {user_id}")
    return BoardData.model_validate(json.loads(row["data"]))


def save_board(conn: sqlite3.Connection, user_id: int, board: BoardData) -> None:
    now = datetime.now(UTC).isoformat()
    conn.execute(
        "UPDATE boards SET data = ?, updated_at = ? WHERE user_id = ?",
        (board.model_dump_json(), now, user_id),
    )
    conn.commit()
