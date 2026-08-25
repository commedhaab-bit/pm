# Frontend

Next.js app for the Kanban board. Currently a client-only demo: all state lives in React,
nothing is persisted, and there is no backend call yet.

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
- `src/app/page.tsx` - renders `KanbanBoard` and nothing else.
- `src/app/globals.css` - Tailwind import plus the CSS variables for the color scheme
  (`--accent-yellow`, `--primary-blue`, `--secondary-purple`, `--navy-dark`, `--gray-text`,
  and surface/stroke/shadow tokens).
- `src/lib/kanban.ts` - data model and pure logic.
- `src/components/` - the board UI.
- `src/test/setup.ts` - loads `@testing-library/jest-dom`.
- `tests/kanban.spec.ts` - Playwright specs. By default run against the Docker container
  at `http://localhost:8000` (must already be up, e.g. via `scripts/start.sh`); set
  `PW_BASE_URL=http://127.0.0.1:3000` to run against a local `next dev` instead, which
  Playwright will start automatically for that URL.
- `next.config.ts` - `output: "export"`. The app is built once as static HTML/JS/CSS and
  served by the FastAPI backend; there is no Next.js server at runtime, so no SSR, no
  server components with server-only behaviour, and no Next middleware.

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

- `KanbanBoard.tsx` (`"use client"`) - the only stateful component. Holds `BoardData` in
  `useState`, owns the `DndContext` (PointerSensor with a 6px activation distance,
  `closestCorners` collision detection) and the handlers: `handleDragStart`/`handleDragEnd`,
  `handleRenameColumn`, `handleAddCard`, `handleDeleteCard`. Renders the page header and
  the five column grid.
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
- Any persistence or API call - a refresh resets the board to `initialData`
- Sign in and sign out
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
