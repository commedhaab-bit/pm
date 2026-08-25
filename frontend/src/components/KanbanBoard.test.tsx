import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanBoard } from "@/components/KanbanBoard";
import type { BoardData } from "@/lib/kanban";

const makeBoard = (): BoardData => ({
  columns: [
    { id: "col-backlog", title: "Backlog", cardIds: ["card-1", "card-2"] },
    { id: "col-discovery", title: "Discovery", cardIds: ["card-3"] },
    { id: "col-progress", title: "In Progress", cardIds: ["card-4", "card-5"] },
    { id: "col-review", title: "Review", cardIds: ["card-6"] },
    { id: "col-done", title: "Done", cardIds: ["card-7", "card-8"] },
  ],
  cards: Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => {
      const id = `card-${i + 1}`;
      return [id, { id, title: `Card ${i + 1}`, details: `Details ${i + 1}` }];
    })
  ),
});

const mockResponse = (body: unknown, ok = true, status = ok ? 200 : 500) => ({
  ok,
  status,
  json: async () => body,
});

const getFirstColumn = () => screen.getAllByTestId(/column-/i)[0];

const putCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT");

describe("KanbanBoard", () => {
  let board: BoardData;
  let fetchMock: ReturnType<typeof vi.fn>;
  let putShouldFail: boolean;
  let nextChatResult: { reply: string; board: BoardData | null };

  beforeEach(() => {
    board = makeBoard();
    putShouldFail = false;
    nextChatResult = { reply: "OK", board: null };
    fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (url === "/api/board" && method === "GET") {
        return Promise.resolve(mockResponse(board));
      }
      if (url === "/api/board" && method === "PUT") {
        if (putShouldFail) {
          return Promise.resolve(mockResponse(null, false));
        }
        return Promise.resolve(mockResponse(JSON.parse(init!.body as string)));
      }
      if (url === "/api/chat" && method === "GET") {
        return Promise.resolve(mockResponse({ messages: [] }));
      }
      if (url === "/api/chat" && method === "POST") {
        return Promise.resolve(mockResponse(nextChatResult));
      }
      return Promise.reject(new Error(`Unhandled fetch: ${method} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  const renderBoard = async () => {
    render(<KanbanBoard />);
    await screen.findAllByTestId(/^column-/i);
  };

  it("renders the board fetched from the API", async () => {
    await renderBoard();
    expect(screen.getAllByTestId(/^column-/i)).toHaveLength(5);
    expect(screen.getAllByTestId(/^card-/i)).toHaveLength(8);
  });

  it("adding a card issues a PUT containing the new card", async () => {
    await renderBoard();
    const column = getFirstColumn();
    await userEvent.click(within(column).getByRole("button", { name: /add a card/i }));
    await userEvent.type(within(column).getByPlaceholderText(/card title/i), "New card");
    await userEvent.click(within(column).getByRole("button", { name: /add card/i }));

    expect(within(column).getByText("New card")).toBeInTheDocument();
    await waitFor(() => expect(putCalls(fetchMock)).toHaveLength(1));
    const body = JSON.parse(putCalls(fetchMock)[0][1].body as string);
    expect(Object.values(body.cards)).toContainEqual(
      expect.objectContaining({ title: "New card" })
    );
  });

  it("deleting a card issues a PUT without that card", async () => {
    await renderBoard();
    const column = getFirstColumn();
    await userEvent.click(within(column).getByRole("button", { name: /delete card 1/i }));

    expect(within(column).queryByText("Card 1")).not.toBeInTheDocument();
    await waitFor(() => expect(putCalls(fetchMock)).toHaveLength(1));
    const body = JSON.parse(putCalls(fetchMock)[0][1].body as string);
    expect(body.cards["card-1"]).toBeUndefined();
  });

  it("editing a card issues a PUT with the updated title and details", async () => {
    await renderBoard();
    const column = getFirstColumn();
    await userEvent.click(within(column).getByRole("button", { name: /edit card 1/i }));

    const titleInput = within(column).getByLabelText(/edit title for card 1/i);
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, "Updated title");
    await userEvent.click(within(column).getByRole("button", { name: /^save$/i }));

    expect(within(column).getByText("Updated title")).toBeInTheDocument();
    await waitFor(() => expect(putCalls(fetchMock)).toHaveLength(1));
    const body = JSON.parse(putCalls(fetchMock)[0][1].body as string);
    expect(body.cards["card-1"].title).toBe("Updated title");
  });

  it("debounces rapid rename keystrokes into a single PUT", async () => {
    await renderBoard();
    const column = getFirstColumn();
    const input = within(column).getByLabelText("Column title");

    await userEvent.clear(input);
    await userEvent.type(input, "Renamed");

    expect(putCalls(fetchMock)).toHaveLength(0);

    await waitFor(() => expect(putCalls(fetchMock)).toHaveLength(1), {
      timeout: 2000,
    });
    const body = JSON.parse(putCalls(fetchMock)[0][1].body as string);
    expect(body.columns[0].title).toBe("Renamed");
  });

  it("reverts the UI and shows an error when a save fails", async () => {
    await renderBoard();
    putShouldFail = true;
    const column = getFirstColumn();
    await userEvent.click(within(column).getByRole("button", { name: /delete card 1/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not save your change/i
    );
    expect(within(column).getByText("Card 1")).toBeInTheDocument();
  });

  it("applies a board update from the AI assistant without a manual reload", async () => {
    await renderBoard();
    await userEvent.click(screen.getByRole("button", { name: /ai assistant/i }));

    const updatedBoard: BoardData = {
      ...board,
      columns: board.columns.map((column) => {
        if (column.id === "col-backlog") {
          return { ...column, cardIds: column.cardIds.filter((id) => id !== "card-1") };
        }
        if (column.id === "col-done") {
          return { ...column, cardIds: [...column.cardIds, "card-1"] };
        }
        return column;
      }),
      cards: board.cards,
    };
    nextChatResult = { reply: "Moved it to Done.", board: updatedBoard };

    await userEvent.type(screen.getByLabelText("Message"), "Move card 1 to done");
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));

    expect(await screen.findByText("Moved it to Done.")).toBeInTheDocument();

    const doneColumn = screen.getByTestId("column-col-done");
    const backlogColumn = screen.getByTestId("column-col-backlog");
    expect(within(doneColumn).getByText("Card 1")).toBeInTheDocument();
    expect(within(backlogColumn).queryByText("Card 1")).not.toBeInTheDocument();

    // The board came already-persisted from the chat endpoint - applying it
    // client-side must not trigger a redundant PUT.
    expect(putCalls(fetchMock)).toHaveLength(0);
  });
});
