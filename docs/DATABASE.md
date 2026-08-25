# Database

SQLite. Two tables: `users` and `boards`, one board per user, the board's content stored as
a single JSON document rather than normalized into rows.

## Schema

```sql
CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
);

CREATE TABLE boards (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL UNIQUE REFERENCES users(id),
    data       TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

- `user_id` is `UNIQUE`, giving the "one board per user" MVP limit a real constraint instead
  of just application-level discipline. Multiple users are already supported by having a
  `users` table at all, per the root AGENTS.md's "database will support multiple users for
  future" - lifting the one-board-per-user limit later only means dropping that constraint.
- `created_at` / `updated_at` are ISO 8601 UTC strings (`datetime.now(UTC).isoformat()`).
  SQLite has no native datetime type, and text is the idiomatic choice there - it sorts and
  compares correctly, and needs no driver-specific type adapter.
- `password_hash`: hashed with `hashlib.sha256`, no per-user salt. This is a hardcoded
  single-user MVP that runs locally in a docker container (per the root AGENTS.md's
  Limitations) - the credential pair itself is the constant `user` / `password`. A salted,
  slow hash (bcrypt/argon2) would be the right call the moment real user-chosen passwords
  or a real deployment target enter the picture; noted here so that requirement isn't
  forgotten if the app ever grows past its current MVP limitations.

## The board document (`boards.data`)

Stored exactly as the frontend's existing `BoardData` shape (`frontend/src/lib/kanban.ts`),
so the JSON is identical in the database, over the `GET`/`PUT /api/board` API, and in the AI
prompt - no translation layer anywhere in the stack:

```json
{
  "columns": [
    { "id": "col-backlog", "title": "Backlog", "cardIds": ["card-1", "card-2"] },
    { "id": "col-discovery", "title": "Discovery", "cardIds": ["card-3"] },
    { "id": "col-progress", "title": "In Progress", "cardIds": ["card-4", "card-5"] },
    { "id": "col-review", "title": "Review", "cardIds": ["card-6"] },
    { "id": "col-done", "title": "Done", "cardIds": ["card-7", "card-8"] }
  ],
  "cards": {
    "card-1": { "id": "card-1", "title": "...", "details": "..." }
  }
}
```

## Seeding

On startup, if the `users` table is empty: insert the `user` / `password` account, then
insert one board for it whose `data` is the current `frontend/src/lib/kanban.ts`
`initialData` (five columns, eight cards, reproduced above). Startup is idempotent - it
only seeds when the table is empty, so restarting the container never duplicates the user
or resets an already-modified board.

The five column ids (`col-backlog`, `col-discovery`, `col-progress`, `col-review`,
`col-done`) are fixed constants, identical for every user - not generated per-user. That
matches "fixed columns that can be renamed" from the root AGENTS.md (titles change, columns
never get added, removed, or reassigned ids), and it means Part 9's AI system prompt can
name the five column ids directly instead of having to look them up first.

## Invariants the backend enforces

Checked in Part 6 before any board write is accepted (login, hand-written API calls, and
later the AI's proposed updates in Part 9 all go through the same check):

- Exactly the five fixed columns, present in a fixed set of ids, each renameable but never
  added, removed, or re-identified
- Every id in a column's `cardIds` exists as a key in `cards`
- Every card in `cards` appears in exactly one column's `cardIds` - no duplicates across
  columns, no orphans left in `cards` but absent from every column

A board that fails any of these is rejected outright (422) rather than partially applied.

## Why a JSON blob instead of a normalized schema

A normalized schema (separate `columns` and `cards` tables, foreign keys, an ordering
column) would let the database enforce some of the invariants above itself, and would allow
querying/filtering individual cards in SQL. Neither matters here: there's exactly one board
per user, it's always read and written as a whole (the frontend holds the whole thing in
one `useState`, and the AI prompt needs the whole thing every turn regardless), and the
invariants above are simple enough to check in a few lines of Python on every write. Rows
and foreign keys buy safety only when something else can write around the application layer
or when partial reads/writes are common - neither is true for a single-board MVP with one
API. If a future version needs per-card history, concurrent multi-user editing of one
board, or querying across boards, that's the point to move to the normalized shape; nothing
above blocks that migration, since the JSON document already has stable ids for every
column and card.

## What changes if usage limits are lifted later

- Multiple boards per user: drop the `UNIQUE` on `boards.user_id`, add a board id to the
  API paths.
- Real user accounts: `password_hash` moves to a proper salted hash; `users` gains whatever
  profile fields are needed. No schema shape changes.
- Custom columns per board: no longer a fixed, shared set of five ids - would need the
  normalized schema described above (or at least an owned list of column definitions per
  board) so the AI's system prompt and the invariant checks can't assume a global constant.
