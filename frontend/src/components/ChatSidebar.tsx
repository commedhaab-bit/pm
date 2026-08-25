"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { BoardData } from "@/lib/kanban";
import { getChatHistory, sendChatMessage, type ChatMessage } from "@/lib/api";

type DisplayMessage = ChatMessage & { boardUpdated?: boolean };

type ChatSidebarProps = {
  onClose: () => void;
  onBoardUpdated: (board: BoardData) => void;
};

export const ChatSidebar = ({ onClose, onBoardUpdated }: ChatSidebarProps) => {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    getChatHistory()
      .then((history) => {
        if (!cancelled) {
          setMessages(history);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not load chat history.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingHistory(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isSending]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isSending) {
      return;
    }

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setIsSending(true);
    setError(null);

    try {
      const result = await sendChatMessage(text);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.reply,
          boardUpdated: Boolean(result.board),
        },
      ]);
      if (result.board) {
        onBoardUpdated(result.board);
      }
    } catch {
      setError("Could not send your message. Please try again.");
      setInput(text);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  return (
    <aside
      className="flex w-full max-w-96 shrink-0 flex-col border-l border-[var(--stroke)] bg-white/90 backdrop-blur"
      aria-label="AI assistant"
    >
      <div className="flex items-center justify-between border-b border-[var(--stroke)] px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--gray-text)]">
            AI Assistant
          </p>
          <p className="mt-1 text-sm text-[var(--navy-dark)]">
            Ask me to update your board
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close AI assistant"
          className="rounded-full border border-[var(--stroke)] px-3 py-1 text-xs font-semibold text-[var(--gray-text)] transition hover:text-[var(--navy-dark)]"
        >
          Close
        </button>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto px-5 py-4"
        aria-live="polite"
      >
        {isLoadingHistory && (
          <p className="text-sm text-[var(--gray-text)]">Loading conversation...</p>
        )}
        {!isLoadingHistory && messages.length === 0 && (
          <p className="text-sm text-[var(--gray-text)]">
            Try &ldquo;Move the roadmap card to Done&rdquo; or &ldquo;Add a card about
            writing release notes.&rdquo;
          </p>
        )}
        {messages.map((message, index) => (
          <div
            key={index}
            className={
              message.role === "user"
                ? "ml-8 rounded-2xl rounded-br-sm bg-[var(--secondary-purple)] px-4 py-2 text-sm text-white"
                : "mr-8 rounded-2xl rounded-bl-sm border border-[var(--stroke)] bg-white px-4 py-2 text-sm text-[var(--navy-dark)]"
            }
          >
            <p className="whitespace-pre-wrap">{message.content}</p>
            {message.boardUpdated && (
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-[var(--accent-yellow)]">
                Board updated
              </p>
            )}
          </div>
        ))}
        {isSending && (
          <p className="mr-8 rounded-2xl rounded-bl-sm border border-[var(--stroke)] bg-white px-4 py-2 text-sm text-[var(--gray-text)]">
            Thinking...
          </p>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="border-t border-[var(--stroke)] px-5 py-2 text-xs font-medium text-red-600"
        >
          {error}
        </p>
      )}

      <div className="border-t border-[var(--stroke)] p-4">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isSending}
          rows={2}
          placeholder="Ask the AI to update your board..."
          aria-label="Message"
          className="w-full resize-none rounded-xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)] disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={isSending || !input.trim()}
          className="mt-2 w-full rounded-full bg-[var(--secondary-purple)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:brightness-110 disabled:opacity-60"
        >
          {isSending ? "Sending..." : "Send"}
        </button>
      </div>
    </aside>
  );
};
