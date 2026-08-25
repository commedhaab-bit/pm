"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ChatSidebar } from "@/components/ChatSidebar";
import { KanbanColumn } from "@/components/KanbanColumn";
import { KanbanCardPreview } from "@/components/KanbanCardPreview";
import { createId, moveCard, type BoardData } from "@/lib/kanban";
import { apiFetch, UnauthorizedError } from "@/lib/api";

const RENAME_DEBOUNCE_MS = 500;

type KanbanBoardProps = {
  onSignOut?: () => void;
};

export const KanbanBoard = ({ onSignOut }: KanbanBoardProps = {}) => {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const lastSavedBoard = useRef<BoardData | null>(null);
  const renameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  useEffect(() => {
    let cancelled = false;

    apiFetch("/api/board")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load board: ${response.status}`);
        }
        const data: BoardData = await response.json();
        if (cancelled) {
          return;
        }
        lastSavedBoard.current = data;
        setBoard(data);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        if (err instanceof UnauthorizedError) {
          window.location.href = "/login";
          return;
        }
        setError("Could not load your board. Please try again.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const saveBoard = async (next: BoardData) => {
    try {
      const response = await apiFetch("/api/board", {
        method: "PUT",
        body: JSON.stringify(next),
      });
      if (!response.ok) {
        throw new Error(`Failed to save board: ${response.status}`);
      }
      lastSavedBoard.current = next;
      setError(null);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        window.location.href = "/login";
        return;
      }
      if (lastSavedBoard.current) {
        setBoard(lastSavedBoard.current);
      }
      setError("Could not save your change. Please try again.");
    }
  };

  const applyAndSave = (next: BoardData) => {
    setBoard(next);
    void saveBoard(next);
  };

  const cardsById = useMemo(() => board?.cards ?? {}, [board]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveCardId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCardId(null);

    if (!board || !over || active.id === over.id) {
      return;
    }

    const nextColumns = moveCard(board.columns, active.id as string, over.id as string);
    if (nextColumns === board.columns) {
      return;
    }

    applyAndSave({ ...board, columns: nextColumns });
  };

  const handleRenameColumn = (columnId: string, title: string) => {
    setBoard((prev) => {
      if (!prev) {
        return prev;
      }

      const next: BoardData = {
        ...prev,
        columns: prev.columns.map((column) =>
          column.id === columnId ? { ...column, title } : column
        ),
      };

      if (renameTimer.current) {
        clearTimeout(renameTimer.current);
      }
      renameTimer.current = setTimeout(() => {
        void saveBoard(next);
      }, RENAME_DEBOUNCE_MS);

      return next;
    });
  };

  const handleAddCard = (columnId: string, title: string, details: string) => {
    if (!board) {
      return;
    }
    const id = createId("card");
    applyAndSave({
      ...board,
      cards: {
        ...board.cards,
        [id]: { id, title, details: details || "No details yet." },
      },
      columns: board.columns.map((column) =>
        column.id === columnId
          ? { ...column, cardIds: [...column.cardIds, id] }
          : column
      ),
    });
  };

  const handleDeleteCard = (columnId: string, cardId: string) => {
    if (!board) {
      return;
    }
    applyAndSave({
      ...board,
      cards: Object.fromEntries(
        Object.entries(board.cards).filter(([id]) => id !== cardId)
      ),
      columns: board.columns.map((column) =>
        column.id === columnId
          ? { ...column, cardIds: column.cardIds.filter((id) => id !== cardId) }
          : column
      ),
    });
  };

  const handleEditCard = (cardId: string, title: string, details: string) => {
    if (!board) {
      return;
    }
    applyAndSave({
      ...board,
      cards: {
        ...board.cards,
        [cardId]: { ...board.cards[cardId], title, details },
      },
    });
  };

  const handleBoardUpdatedByAI = (next: BoardData) => {
    // The chat endpoint already validated and persisted this board server-side
    // - it's not a local edit awaiting a PUT, so just adopt it directly.
    lastSavedBoard.current = next;
    setBoard(next);
  };

  if (!board) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <p className="text-sm font-medium text-[var(--gray-text)]">
          {error ?? "Loading your board..."}
        </p>
      </div>
    );
  }

  const activeCard = activeCardId ? cardsById[activeCardId] : null;

  return (
    <div className="flex min-h-screen">
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div className="pointer-events-none absolute left-0 top-0 h-[420px] w-[420px] -translate-x-1/3 -translate-y-1/3 rounded-full bg-[radial-gradient(circle,_rgba(32,157,215,0.25)_0%,_rgba(32,157,215,0.05)_55%,_transparent_70%)]" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-[520px] w-[520px] translate-x-1/4 translate-y-1/4 rounded-full bg-[radial-gradient(circle,_rgba(117,57,145,0.18)_0%,_rgba(117,57,145,0.05)_55%,_transparent_75%)]" />

        <main className="relative mx-auto flex min-h-screen max-w-[1500px] flex-col gap-10 px-6 pb-16 pt-12">
          <header className="flex flex-col gap-6 rounded-[32px] border border-[var(--stroke)] bg-white/80 p-8 shadow-[var(--shadow)] backdrop-blur">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
                  Single Board Kanban
                </p>
                <h1 className="mt-3 font-display text-4xl font-semibold text-[var(--navy-dark)]">
                  Kanban Studio
                </h1>
                <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--gray-text)]">
                  Keep momentum visible. Rename columns, drag cards between stages,
                  and capture quick notes without getting buried in settings.
                </p>
              </div>
              <div className="flex flex-col items-end gap-3">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setIsChatOpen((prev) => !prev)}
                    aria-expanded={isChatOpen}
                    className="rounded-full border border-[var(--stroke)] bg-[var(--secondary-purple)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:brightness-110"
                  >
                    {isChatOpen ? "Close assistant" : "AI Assistant"}
                  </button>
                  {onSignOut && (
                    <button
                      type="button"
                      onClick={onSignOut}
                      className="rounded-full border border-[var(--stroke)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)] transition hover:text-[var(--navy-dark)]"
                    >
                      Sign out
                    </button>
                  )}
                </div>
                <div className="rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] px-5 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--gray-text)]">
                    Focus
                  </p>
                  <p className="mt-2 text-lg font-semibold text-[var(--primary-blue)]">
                    One board. Five columns. Zero clutter.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              {board.columns.map((column) => (
                <div
                  key={column.id}
                  className="flex items-center gap-2 rounded-full border border-[var(--stroke)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--navy-dark)]"
                >
                  <span className="h-2 w-2 rounded-full bg-[var(--accent-yellow)]" />
                  {column.title}
                </div>
              ))}
            </div>
          </header>

          {error && (
            <div
              role="alert"
              className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
            >
              {error}
            </div>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <section className="grid gap-6 lg:grid-cols-5">
              {board.columns.map((column) => (
                <KanbanColumn
                  key={column.id}
                  column={column}
                  cards={column.cardIds.map((cardId) => board.cards[cardId])}
                  onRename={handleRenameColumn}
                  onAddCard={handleAddCard}
                  onDeleteCard={handleDeleteCard}
                  onEditCard={handleEditCard}
                />
              ))}
            </section>
            <DragOverlay>
              {activeCard ? (
                <div className="w-[260px]">
                  <KanbanCardPreview card={activeCard} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </main>
      </div>

      {isChatOpen && (
        <ChatSidebar
          onClose={() => setIsChatOpen(false)}
          onBoardUpdated={handleBoardUpdatedByAI}
        />
      )}
    </div>
  );
};
