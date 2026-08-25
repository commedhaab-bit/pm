# Frontend

Next.js app for the Kanban board. The board itself is still a client-only demo: all board
state lives in React and nothing is persisted. Sign in is real - it talks to the backend's
session-cookie auth.

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
  `UnauthorizedError` - see the `api.ts` note above for why that distinction is there.
- `src/app/login/page.tsx` (`"use client"`) - login form. Calls `login()` from
  `src/lib/api.ts`; on success, hard-navigates to `/`; on failure, shows an inline error
  and stays put.
- `src/lib/api.ts` - `apiFetch` wraps `fetch` with `credentials: "include"` and throws
  `UnauthorizedError` on a 401. `login`/`logout`/`getCurrentUser` wrap the three auth
  routes; `getCurrentUser` catches only `UnauthorizedError` and returns `null` for it (an
  unauthenticated `/api/me` is an expected, not exceptional, result for the page guard) -
  anything else (a non-401 error response, a network failure) is rethrown rather than
  also folded into `null`. That distinction matters: a transient 500 is not the same fact
  as "not signed in", and conflating them once caused a real bug (see `page.tsx` below).
- `src/app/globals.css` - Tailwind import plus the CSS variables for the color scheme
  (`--accent-yellow`, `--primary-blue`, `--secondary-purple`, `--navy-dark`, `--gray-text`,
  and surface/stroke/shadow tokens).
- `src/lib/kanban.ts` - data model and pure logic.
- `src/components/` - the board UI.
- `src/test/setup.ts` - loads `@testing-library/jest-dom`.
- `tests/kanban.spec.ts`, `tests/auth.spec.ts` - Playwright specs. By default run against
  the Docker container at `http://localhost:8000` (must already be up, e.g. via
  `scripts/start.sh`); set `PW_BASE_URL=http://127.0.0.1:3000` to run against a local
  `next dev` instead, which Playwright will start automatically for that URL.
  `kanban.spec.ts` logs in via `page.request.post("/api/login", ...)` in a `beforeEach`
  (shares the browser context's cookie jar with `page`, so no UI login needed) since every
  route now requires a session.
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
Ordering therefore lives entirely in `column.cardIds`.

Exports:

- `initialData` - hardcoded demo board: five columns (Backlog, Discovery, In Progress,
  Review, Done) and eight cards. This is the seed data the backend will eventually own.
- `moveCard(columns, activeId, overId)` - pure reducer for drag and drop. Handles reorder
  within a column, move between columns, and drops onto an empty column (`overId` is a
  column id rather than a card id). Returns the input unchanged when the move is a no-op.
- `createId(prefix)` - id from random suffix plus timestamp, e.g. `card-x1y2z3mfa1b2`.

## Components

- `KanbanBoard.tsx` (`"use client"`) - the only stateful board component. Holds `BoardData`
  in `useState`, owns the `DndContext` (PointerSensor with a 6px activation distance,
  `closestCorners` collision detection) and the handlers: `handleDragStart`/`handleDragEnd`,
  `handleRenameColumn`, `handleAddCard`, `handleDeleteCard`. Renders the page header and
  the five column grid. Takes an optional `onSignOut` prop; when present, renders a
  "Sign out" button in the header.
- `KanbanColumn.tsx` - droppable column. Renders the card count, an always-editable title
  input (calls `onRename` on every keystroke), a `SortableContext` over the column's cards,
  an empty-state placeholder, and `NewCardForm`.
- `KanbanCard.tsx` - sortable card. The whole article is the drag handle. Shows title,
  details, and a Remove button.
- `KanbanCardPreview.tsx` - presentation-only copy of the card used inside `DragOverlay`.
- `NewCardForm.tsx` - collapsed "Add a card" button that expands into a title/details form.
  Title is required; blank details become "No details yet." in `KanbanBoard`.

Test hooks: `data-testid="column-{id}"` and `data-testid="card-{id}"`; the column title
input is found by `aria-label="Column title"`; the delete button by
`aria-label="Delete {title}"`.

## Not implemented yet

- Editing an existing card (only add, delete, move)
- Persisting the board - a refresh resets it to `initialData`; sign in/out is the only
  real API traffic so far
- The AI chat sidebar

## Commands

```
npm run dev          # dev server on 3000
npm run build        # production build
npm run lint         # eslint
npm run test:unit    # vitest run
npm run test:e2e     # playwright (starts its own dev server)
npm run test:all     # both
```
