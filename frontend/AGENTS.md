# Frontend

Next.js app for the Kanban board. The board, sign in, and the AI assistant are all real:
the board loads from and saves to the backend's SQLite-backed API, sign in talks to the
backend's session-cookie auth, and the assistant sidebar talks to `POST /api/chat`.

## Stack

- Next.js 16 (App Router) with React 19 and TypeScript in strict mode
- Tailwind CSS 4 via `@tailwindcss/postcss`, configured in `src/app/globals.css`
- `@dnd-kit/core` and `@dnd-kit/sortable` for drag and drop
- `clsx` for conditional class names
- Vitest + Testing Library (jsdom) for unit tests, Playwright for end to end tests
- Path alias `@/*` maps to `src/*` (set in both `tsconfig.json` and `vitest.config.ts`)

## Layout

- `src/app/layout.tsx` - root layout. Loads Space Grotesk (`--font-display`) and Manrope
  (`--font-body`) through `next/font/google`, so the build needs network access.
- `src/app/page.tsx` (`"use client"`) - the auth guard for `/`. On mount, calls
  `GET /api/me`; if unauthenticated, hard-navigates to `/login` (`window.location.href`,
  not the Next router - there is no server to render a fresh `/login` response to a client
  transition's RSC fetch, only to a full navigation); if authenticated, renders
  `KanbanBoard` with a sign-out handler. Renders nothing while the check is pending, and a
  short message (not a redirect) if `getCurrentUser` rejects for a reason other than
  `UnauthorizedError` - see the `api.ts` note below for why that distinction is there.
- `src/app/login/page.tsx` (`"use client"`) - login form. Calls `login()` from
  `src/lib/api.ts`; on success, hard-navigates to `/`; on failure, shows an inline error
  and stays put.
- `src/lib/api.ts` - `apiFetch` wraps `fetch` with `credentials: "include"` and throws
  `UnauthorizedError` on a 401. `login`/`logout`/`getCurrentUser` wrap the three auth
  routes; `getCurrentUser` catches only `UnauthorizedError` and returns `null` for it (an
  unauthenticated `/api/me` is an expected, not exceptional, result for the page guard) -
  anything else (a non-401 error response, a network failure) is rethrown rather than
  also folded into `null`. That distinction matters: a transient 500 is not the same fact
  as "not signed in", and conflating them once caused a real bug (see `page.tsx` above).
  `KanbanBoard` uses `apiFetch` directly for `GET`/`PUT /api/board`. `getChatHistory`/
  `sendChatMessage` wrap `GET`/`POST /api/chat` for `ChatSidebar`.
- `src/app/globals.css` - Tailwind import plus the CSS variables for the color scheme
  (`--accent-yellow`, `--primary-blue`, `--secondary-purple`, `--navy-dark`, `--gray-text`,
  and surface/stroke/shadow tokens).
- `src/lib/kanban.ts` - data model and pure logic. No longer ships demo data - the seed
  board lives in `backend/app/board.py`'s `INITIAL_BOARD` instead (see the root
  `docs/DATABASE.md`).
- `src/components/` - the board UI.
- `src/test/setup.ts` - loads `@testing-library/jest-dom`.
- `tests/auth.spec.ts`, `tests/kanban.spec.ts`, `tests/persistence.spec.ts`,
  `tests/chat.spec.ts`, `tests/chat.live.spec.ts` - Playwright specs. By default run
  against the Docker container at `http://localhost:8000` (must already be up, e.g. via
  `scripts/start.sh`); set `PW_BASE_URL=http://127.0.0.1:3000` to run against a local
  `next dev` instead, which Playwright will start automatically for that URL. Login is via
  `page.request.post("/api/login", ...)` in a `beforeEach` (shares the browser context's
  cookie jar with `page`, so no UI login needed).

  `chat.live.spec.ts` hits the real OpenAI API and is tagged `{ tag: "@live" }`; it's
  excluded from `npm run test:e2e` (`--grep-invert @live`, mirroring the backend's
  `pytest -m live`/`addopts` split) and run explicitly with `npm run test:e2e:live`.
  `playwright.config.ts` deliberately does **not** set `grepInvert` itself - Playwright ANDs
  a config-level `grepInvert` with any CLI `--grep`, so a config default would have silently
  blocked `--grep @live` from ever selecting it too; the exclusion lives in the npm script
  instead. `chat.spec.ts` mocks the AI at the network boundary the browser talks to
  (`page.route("**/api/chat", ...)`), so it - and the default e2e run as a whole - never
  depends on or costs a real model call; only `chat.live.spec.ts` does, and it restores the
  board afterward (a `PUT` with the board it fetched at the start) since it's the one real,
  shared board.
  **`playwright.config.ts` forces `workers: 1`**: there is exactly one board, shared by the
  one hardcoded user, and it is now genuinely persisted - every board-mutating test acts on
  that same real row, so tests cannot run concurrently against each other without racing.
  Since state also persists *across* runs (not just within one), `kanban.spec.ts`'s tests
  are written to be self-contained and self-cleaning: they create their own throwaway
  card(s) rather than assuming a specific seed card id still exists (an earlier run may
  have already renamed or deleted it), and they delete what they added. The one exception
  is the column rename test, which restores the original title afterwards instead, since
  columns can't be deleted. `persistence.spec.ts` is the one test that actually reloads the
  page mid-test to prove every mutation kind (rename, add, edit, move, delete) survives it,
  then cleans up the same way.

  **Every mutating test action must wait for its own `PUT /api/board` before moving on**,
  via a `waitForBoardSave(page)` helper (`page.waitForResponse` filtered to a PUT on
  `/api/board`) defined in each spec file. `KanbanBoard`'s `applyAndSave` fires that PUT
  fire-and-forget (see `KanbanBoard.tsx` below), and Playwright tears the page down the
  moment a test function returns - an in-flight fetch gets aborted, not awaited. Two
  distinct failure modes came from this before every mutation had a wait, both discovered
  only by running the suite repeatedly (a single run rarely caught it - these are races,
  not deterministic bugs):
  - A test's *own* later assertion breaks: `persistence.spec.ts` used to reload immediately
    after its drag, no wait in between; the reload sometimes raced ahead of the drag's PUT
    and refetched the pre-move board, failing the "card moved" assertion.
  - A test's cleanup silently never reaches the server, permanently orphaning data in the
    one real shared board: e.g. `kanban.spec.ts`'s tests assert against local React state
    (which updates optimistically, before any network round trip), so they'd report a
    passing "card deleted" even though the delete's PUT got aborted mid-flight - the card
    would still be sitting in the database for the next run to trip over.
  - A related trap once the wait exists: register `waitForBoardSave` *before* triggering the
    action, and don't let it silently catch a *different*, still-in-flight PUT from an
    earlier unwaited step - `page.waitForResponse`'s predicate only matches "a PUT to
    `/api/board`", not "the one this exact action caused". Skipping the wait on a delete
    right before starting one for a rename let the rename's wait resolve on the delete's
    (unrelated) response instead, so the rename looked saved when it hadn't fired yet.
  If you add a new mutating e2e action, give it the same treatment.
- `next.config.ts` - `output: "export"`. The app is built once as static HTML/JS/CSS and
  served by the FastAPI backend; there is no Next.js server at runtime, so no SSR, no
  server components with server-only behaviour, and no Next middleware. One consequence:
  the backend cannot gate `/` server-side, so an unauthenticated request for `/` still gets
  200 and the same static shell - the redirect to `/login` happens client-side, after load.

## Data model (`src/lib/kanban.ts`)

```ts
type Card = { id: string; title: string; details: string };
type Column = { id: string; title: string; cardIds: string[] };
type BoardData = { columns: Column[]; cards: Record<string, Card> };
```

Cards are stored once in a `cards` lookup; each column holds an ordered list of card ids.
Ordering therefore lives entirely in `column.cardIds`. This is the exact shape
`backend/app/board.py`'s `BoardData` Pydantic model validates and `GET`/`PUT /api/board`
send and accept - no translation layer between the two.

Exports:

- `moveCard(columns, activeId, overId)` - pure reducer for drag and drop. Handles reorder
  within a column, move between columns, and drops onto an empty column (`overId` is a
  column id rather than a card id). Returns the input unchanged when the move is a no-op.
- `createId(prefix)` - id from random suffix plus timestamp, e.g. `card-x1y2z3mfa1b2`. Used
  client-side for new card ids before they're saved.

## Components

- `KanbanBoard.tsx` (`"use client"`) - the stateful board component. `board` is
  `BoardData | null`; `null` means "still loading" (or a failed initial load, distinguished
  by an `error` string also being set) and renders a short status message instead of the
  board. On mount, fetches `GET /api/board`; a 401 there hard-navigates to `/login` (a
  session can expire while the tab is open), anything else sets the error message.
  Every mutation follows the same `applyAndSave` pattern: update `board` immediately
  (optimistic), then `PUT` the new board in the background; on failure, revert to
  `lastSavedBoard` (a ref tracking the last state the server actually accepted) and show an
  error banner above the columns. Column rename is the one exception - typing updates the
  input immediately but the `PUT` is debounced 500ms after the last keystroke
  (`RENAME_DEBOUNCE_MS`), so a revert-on-failure there rolls back to the last *saved*
  title, not the last keystroke. Owns the `DndContext` (PointerSensor with a 6px activation
  distance, `closestCorners` collision detection). Takes an optional `onSignOut` prop; when
  present, renders a "Sign out" button in the header. Also owns `isChatOpen`; when true, a
  flex layout puts `ChatSidebar` alongside the board (the board's own wrapper is `flex-1
  min-w-0`, so it shrinks to make room rather than the sidebar overlapping it) and
  `handleBoardUpdatedByAI` is passed down as `onBoardUpdated` - it adopts a board the chat
  endpoint returns directly (`setBoard` + updates `lastSavedBoard`), with no `PUT`, since
  that board is already validated and persisted server-side by `/api/chat` itself; issuing
  one anyway would be redundant at best.
- `KanbanColumn.tsx` - droppable column. Renders the card count, an always-editable title
  input (calls `onRename` on every keystroke), a `SortableContext` over the column's cards,
  an empty-state placeholder, and `NewCardForm`. Passes `onEditCard` through to each
  `KanbanCard`.
- `KanbanCard.tsx` - sortable card with two render modes. Normally: title, details, an Edit
  button and a Remove button, with the whole article as the drag handle (dnd-kit's 6px
  activation distance means a plain click on either button doesn't start a drag - this is
  also why the inline editor below is safe to put inside the same sortable article).
  Clicking Edit swaps in an inline title input + details textarea with Save/Cancel; while
  editing, the article does *not* get `{...attributes} {...listeners}` spread onto it, so
  dragging is disabled for the duration (avoids fighting text selection in the textarea).
  Save calls `onEdit(cardId, title, details)` (title required, like `NewCardForm`); Cancel
  discards the local edit.
- `KanbanCardPreview.tsx` - presentation-only copy of the card used inside `DragOverlay`.
- `NewCardForm.tsx` - collapsed "Add a card" button that expands into a title/details form.
  Title is required; blank details become "No details yet." in `KanbanBoard`.
- `ChatSidebar.tsx` (`"use client"`) - the AI assistant panel. Loads history via
  `getChatHistory` on mount (`GET /api/chat`); shows a loading state, then either the
  history or a short suggestion if there isn't any yet. Sending: appends the user's message
  to the transcript immediately, clears the input, calls `sendChatMessage`; on success
  appends the assistant's reply (with a "Board updated" note if the response carried a
  board, and calling `onBoardUpdated` with it) and clears any error; on failure, restores
  the typed text into the input (so a failed send never loses it) and shows an error below
  the transcript, leaving the optimistic user bubble in place either way. `isSending` disables
  the Send button and the textarea for the duration, so a message can't be double-submitted.
  Enter sends; Shift+Enter inserts a newline (`onKeyDown` checks `event.shiftKey`). The
  transcript div scrolls to `scrollHeight` on every new message - via a plain `scrollTop`
  assignment, not `Element.scrollTo()`, since jsdom doesn't implement the latter and this
  needs to work under Vitest too, not just in a real browser.

Test hooks: `data-testid="column-{id}"` and `data-testid="card-{id}"`; the column title
input is found by `aria-label="Column title"`; a card's buttons by `aria-label="Edit {title}"`
/ `aria-label="Delete {title}"`; the inline editor's fields by
`aria-label="Edit title for {title}"` / `aria-label="Edit details for {title}"` (all keyed
off the card's title *before* editing starts, since that's what's stable while the form is
open).

## Commands

```
npm run dev            # dev server on 3000
npm run build          # production build
npm run lint           # eslint
npm run test:unit      # vitest run
npm run test:e2e       # playwright, excluding @live-tagged tests
npm run test:e2e:live  # only the @live-tagged tests, against the real model
npm run test:all       # test:unit then test:e2e
```
