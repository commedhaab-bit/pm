import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatSidebar } from "@/components/ChatSidebar";
import type { BoardData } from "@/lib/kanban";

const mockResponse = (body: unknown, ok = true, status = ok ? 200 : 500) => ({
  ok,
  status,
  json: async () => body,
});

const sampleBoard: BoardData = {
  columns: [{ id: "col-done", title: "Done", cardIds: ["card-1"] }],
  cards: { "card-1": { id: "card-1", title: "A card", details: "Some details" } },
};

describe("ChatSidebar", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let history: { role: string; content: string }[];
  let nextChatResult: { reply: string; board: BoardData | null };

  beforeEach(() => {
    history = [];
    nextChatResult = { reply: "Hi there!", board: null };
    fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (url === "/api/chat" && method === "GET") {
        return Promise.resolve(mockResponse({ messages: history }));
      }
      if (url === "/api/chat" && method === "POST") {
        return Promise.resolve(mockResponse(nextChatResult));
      }
      return Promise.reject(new Error(`Unhandled fetch: ${method} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("renders history loaded from the server", async () => {
    history = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi! How can I help?" },
    ];
    render(<ChatSidebar onClose={vi.fn()} onBoardUpdated={vi.fn()} />);

    expect(await screen.findByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("Hi! How can I help?")).toBeInTheDocument();
  });

  it("sends on Enter and inserts a newline on Shift+Enter", async () => {
    render(<ChatSidebar onClose={vi.fn()} onBoardUpdated={vi.fn()} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const input = screen.getByLabelText("Message");
    await userEvent.type(input, "Line one");
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    await userEvent.type(input, "Line two");
    expect(input).toHaveValue("Line one\nLine two");

    nextChatResult = { reply: "Got it.", board: null };
    await userEvent.keyboard("{Enter}");

    expect(await screen.findByText("Got it.")).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("sends a message and appends the reply", async () => {
    render(<ChatSidebar onClose={vi.fn()} onBoardUpdated={vi.fn()} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    nextChatResult = { reply: "Sure, done.", board: null };
    await userEvent.type(screen.getByLabelText("Message"), "Add a card");
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));

    expect(await screen.findByText("Add a card")).toBeInTheDocument();
    expect(await screen.findByText("Sure, done.")).toBeInTheDocument();
  });

  it("calls onBoardUpdated and shows a badge when the reply changes the board", async () => {
    const onBoardUpdated = vi.fn();
    render(<ChatSidebar onClose={vi.fn()} onBoardUpdated={onBoardUpdated} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    nextChatResult = { reply: "Moved it.", board: sampleBoard };
    await userEvent.type(screen.getByLabelText("Message"), "Move the card");
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));

    expect(await screen.findByText("Moved it.")).toBeInTheDocument();
    expect(screen.getByText(/board updated/i)).toBeInTheDocument();
    expect(onBoardUpdated).toHaveBeenCalledWith(sampleBoard);
  });

  it("shows an error and keeps the typed message when sending fails", async () => {
    render(<ChatSidebar onClose={vi.fn()} onBoardUpdated={vi.fn()} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (url === "/api/chat" && method === "POST") {
        return Promise.resolve(mockResponse(null, false));
      }
      return Promise.resolve(mockResponse({ messages: [] }));
    });

    const input = screen.getByLabelText("Message");
    await userEvent.type(input, "This will fail");
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not send your message/i
    );
    expect(input).toHaveValue("This will fail");
  });

  it("disables the send button while a message is in flight", async () => {
    let resolveSend: (value: unknown) => void = () => {};
    render(<ChatSidebar onClose={vi.fn()} onBoardUpdated={vi.fn()} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (url === "/api/chat" && method === "POST") {
        return new Promise((resolve) => {
          resolveSend = resolve;
        });
      }
      return Promise.resolve(mockResponse({ messages: [] }));
    });

    await userEvent.type(screen.getByLabelText("Message"), "Slow message");
    const sendButton = screen.getByRole("button", { name: /sending|^send$/i });
    await userEvent.click(sendButton);

    expect(await screen.findByRole("button", { name: /sending/i })).toBeDisabled();

    resolveSend(mockResponse({ reply: "Done", board: null }));
    await screen.findByText("Done");
  });
});
