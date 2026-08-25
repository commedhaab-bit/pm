# Code review

Full-repo review of the PM Kanban app (backend, frontend, infra, tests, docs) as of commit
`e9cebf4`. Scope: every file under `backend/app`, `frontend/src`, plus tests, Docker/compose,
start/stop scripts, and the `docs/` specs.

**Verification performed before writing this up**: `uv run pytest` (25 passed, 2 deselected),
`npm run lint` (clean), `npm run test:unit` (25 passed), `npm run build` (clean, including
Next's own TypeScript check). All green — nothing below is a regression; these are gaps found
by reading the code, not failures surfaced by the existing suite.

## Summary

The codebase is small, consistent, and unusually well documented (`AGENTS.md` at every
level, `docs/DATABASE.md`, `docs/PLAN.md` with a recorded history of bugs already found and
fixed during development). The single shared `BoardData` shape across frontend/backend/DB/AI
and the invariant validation on every write path are the strongest parts of the design. The
issues below are the real gaps that remain — none block the MVP as scoped, but several are
worth fixing cheaply, and a couple are worth knowing about before this grows past "one
hardcoded local user."

| # | Severity | Area | Issue |
|---|----------|------|-------|
| 1 | Medium | Backend / DB | Concurrent first-run seeding race in `get_db()` can 500 |
| 2 | Medium | Backend / Frontend | No ordering guarantee on board saves; stale writes can win |
| 3 | Medium | AI chat | A rejected AI board edit leaves a false "success" claim in history |
| 4 | Medium | DX | Missing `OPENAI_API_KEY` fails silently and opaquely at first chat use |
| 5 | Low | Backend | Password comparison is not constant-time |
| 6 | Low | Frontend | Login error message masks real (non-credential) failures |
| 7 | Low | Frontend | Column title can be saved blank; no length limits anywhere |
| 8 | Info | AI chat | User-authored board text is interpolated into the system prompt |

---

## 1. Concurrent first-run seeding race (Medium)

`backend/app/db.py:82-96`

```python
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
```

FastAPI runs sync dependencies like this one through a thread pool (the same reason
`check_same_thread=False` was needed — see the comment in `connect()`). If two requests reach
`get_db()` concurrently before `_ready_paths` has this path in it — realistic right after
`docker compose up` on a fresh volume, e.g. two tabs opening at once, or a health check racing
the first real request — both threads see `path not in _ready_paths`, both call
`seed_if_empty`, and `seed_if_empty`'s own check (`SELECT COUNT(*) FROM users`) is a
check-then-act across two separate connections with no locking. Both can see `count == 0` and
both insert a `user` row, and the second `INSERT` fails on the `users.username UNIQUE`
constraint with an unhandled `sqlite3.IntegrityError` → 500 for that request.

This is the same class of bug already found and fixed once in Part 6 (the
`check_same_thread` issue) — narrow, only visible under real concurrency, not something
`TestClient` reproduces.

**Recommendation**: make seeding itself atomic instead of relying on the `_ready_paths` cache
for correctness — e.g. `INSERT OR IGNORE`/`ON CONFLICT(username) DO NOTHING` for the user row
(and skip the board insert when the ignore fired), or guard the whole init-and-seed block with
a module-level `threading.Lock`. `_ready_paths` can stay as the fast-path skip; it just
shouldn't be the only thing preventing a double seed.

## 2. No ordering guarantee on board saves (Medium)

`frontend/src/components/KanbanBoard.tsx:71-97`, `backend/app/board_routes.py:20-27`

`applyAndSave` fires `PUT /api/board` fire-and-forget with the full board snapshot, and the
backend just overwrites `boards.data` unconditionally — there's no version/`updated_at` check
and no client-side sequencing of overlapping saves. Two mutations issued close together (e.g.
a drag immediately followed by an edit) produce two independent in-flight requests with no
guarantee they resolve in the order they were sent. If the older request's response arrives
second, two things go wrong: the server ends up persisting the *older* board (silently losing
the newer edit until the next mutation happens to re-save it), and the client's
`lastSavedBoard.current` regresses to that older snapshot, so a subsequent failed save would
revert the UI further back than the true last-saved state.

This exact raciness is why `frontend/AGENTS.md` documents `waitForBoardSave` as mandatory in
every Playwright test — the tests work around it, but production usage has no such guard.

**Recommendation**: either sequence saves client-side (queue them, or use an
`AbortController` and ignore a resolved response that's no longer the latest in-flight
request), or add cheap optimistic concurrency server-side (send back `updated_at`, reject a
`PUT` whose base doesn't match with 409, let the client re-fetch and retry). The client-side
fix is less code for an MVP.

## 3. Rejected AI board edits leave a false claim in chat history (Medium)

`backend/app/chat.py:139-152`

```python
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
```

When the model's proposed board fails validation, `updated_board` is dropped and the API
correctly returns `board: null` — but `ai_reply.reply` (the model's own text, e.g. "Moved it
to Done!") is still saved verbatim into `chat_history`. That message is replayed back to the
model as conversation history on every future turn, so the model is now working from a false
premise that its earlier edit succeeded. This can compound: a later "undo that" or "what's in
Done now?" is being asked against a board state the model wrongly believes it already changed.

**Recommendation**: when `updated_board` ends up `None` but the model *did* propose one,
either append a short synthetic system/user note to history ("your last proposed board update
was rejected: <reason>") or strip/annotate the stored assistant message so future prompts
don't inherit the false claim. Logging the validation error would also help — right now a
rejected board fails silently with no server-side record of why.

## 4. Missing `OPENAI_API_KEY` fails silently at first chat use (Medium, DX)

`scripts/start.sh:5-7`, `scripts/start.ps1:3-10`, `backend/app/ai.py:16-22`

The start scripts only ever check for `SESSION_SECRET` in `.env`, generating one if absent —
including creating `.env` from scratch via `>>`/`Add-Content` if it doesn't exist at all. They
never check for `OPENAI_API_KEY`, which the README lists as a prerequisite. Running
`scripts/start.sh` on a clean clone with no `.env` yet "succeeds": the container comes up, the
board and login work fine, and the missing key only surfaces the first time someone opens the
AI sidebar — as `get_client()`'s `RuntimeError`, which propagates as a bare 500, which the
frontend collapses into the generic "Could not send your message. Please try again." The
actual cause (no key configured) is never shown anywhere.

**Recommendation**: have the start scripts warn (not necessarily fail) when `OPENAI_API_KEY`
is missing from `.env`, matching the existing `SESSION_SECRET` check. Optionally have
`POST /api/chat` return a distinguishable error (e.g. 503 with a specific message) when
`get_client()` raises, so the sidebar can show something more actionable than a generic
send failure.

## 5. Password comparison is not constant-time (Low)

`backend/app/auth.py:16-22`

```python
def check_credentials(conn, username, password) -> bool:
    row = conn.execute(...).fetchone()
    if row is None:
        return False
    return row["password_hash"] == hash_password(password)
```

The hash itself (unsalted SHA-256) is already a documented, intentional MVP tradeoff in
`docs/DATABASE.md`. The `==` comparison is a separate, free fix regardless: it's not a
timing-safe comparison, and a missing user short-circuits before hashing at all (revealing,
by timing, whether a username exists). For a single hardcoded local user this isn't a
practical attack, but `hmac.compare_digest` costs nothing and removes the question.

**Recommendation**: swap `==` for `hmac.compare_digest(row["password_hash"], hash_password(password))`.
Leave the hashing scheme itself alone — it's correctly scoped as a "revisit before real
deployment" item in the DB doc already.

## 6. Login error message masks real failures (Low)

`frontend/src/lib/api.ts:26-34`

```ts
export const login = async (username: string, password: string) => {
  const response = await apiFetch("/api/login", { ... });
  if (!response.ok) {
    throw new Error("Invalid username or password");
  }
};
```

Any non-2xx response — a 422 from a malformed request, a 500 from the backend — is reported
to the user as "Invalid username or password.", which is simply wrong for those cases and
would misdirect anyone debugging a real outage.

**Recommendation**: only show the credentials message for a 401; surface a generic
"Something went wrong, please try again" (or the status code) for anything else.

## 7. Column title has no validation; no length limits anywhere (Low)

`frontend/src/components/KanbanColumn.tsx:44-49`

Card titles are trimmed and required before a save fires (`KanbanCard.tsx`, `NewCardForm.tsx`
both check `!trimmedTitle`), but the column title input saves on every keystroke with no such
check, so a column can end up with a blank or whitespace-only title. Separately, nothing —
client or server — caps the length of a card title/details, a column title, or a chat
message; `board.py`'s `Card`/`Column` models have no `max_length`. For an MVP this is
harmless, but the board (titles and all) is re-serialized into the AI system prompt on every
chat turn, so an unusually large card would inflate every subsequent prompt.

**Recommendation**: mirror the card-title guard for column renames (skip/ignore a save when
trimmed title is empty). Length limits are optional polish, not urgent — worth a `max_length`
on `Card`/`Column` fields only if this moves toward real multi-user use.

## 8. User-authored board text is interpolated into the system prompt (Informational)

`backend/app/chat.py:73-88`

`_system_prompt` embeds the live board's JSON — including every card's `title`/`details`,
which are free-text fields the user (or, after an accepted edit, the AI) fully controls —
directly into the **system** message, not a user message. Today that's a non-issue: the only
person who can write those fields is the same person the assistant is answering, on a single
local board with no other users and no tool access beyond editing that one board. It's worth
flagging now because it's the kind of thing that stops being harmless the moment either
changes (e.g. shared boards, or the assistant gaining any capability beyond board edits) —
text a user typed into a card would then carry the elevated trust of a system message rather
than a user message.

**Recommendation**: no action needed at the current MVP scope. If boards ever become shared
or the assistant's capabilities grow, revisit putting board content in a clearly-lower-trust
part of the prompt.

---

## Not flagged (intentional, already documented)

- Unsalted SHA-256 password hashing — called out and justified in `docs/DATABASE.md` for the
  hardcoded single-user MVP.
- `PUT /api/board` fire-and-forget with no request cancellation in tests — already understood
  and worked around via `waitForBoardSave`; see finding #2 for the production-facing half of
  the same gap.
- No signup/multi-tenant UI, no column add/remove — explicitly out of scope per the root
  `AGENTS.md` limitations.
- `SessionMiddleware`'s insecure fallback secret (`"insecure-dev-secret"`) — only used when
  `SESSION_SECRET` is entirely absent (e.g. plain `pytest`); the start scripts always generate
  a real one into `.env` before the container ever runs it.

## Suggested priority order

1. Fix #1 (seeding race) and #5 (`hmac.compare_digest`) — small, self-contained, no design
   changes.
2. Fix #3 (chat history correctness) and #4 (missing key DX) — both cheap and directly affect
   the AI feature's reliability and first-run experience.
3. Fix #6 and #7 — small frontend polish.
4. Decide on an approach for #2 (save ordering) — the one item here that's a real design
   choice rather than a one-line fix; worth a deliberate decision rather than a quick patch.
