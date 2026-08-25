import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.request.post("/api/login", {
    data: { username: "user", password: "password" },
  });
});

test("opens the assistant, sends a message, and applies a board update without reloading", async ({
  page,
}) => {
  const boardResponse = await page.request.get("/api/board");
  const board = await boardResponse.json();
  const backlog = board.columns.find((c: { id: string }) => c.id === "col-backlog");
  const movedCardId: string = backlog.cardIds[0];
  const movedCardTitle: string = board.cards[movedCardId].title;

  const updatedBoard = {
    ...board,
    columns: board.columns.map((column: { id: string; cardIds: string[] }) => {
      if (column.id === "col-backlog") {
        return { ...column, cardIds: column.cardIds.filter((id) => id !== movedCardId) };
      }
      if (column.id === "col-done") {
        return { ...column, cardIds: [...column.cardIds, movedCardId] };
      }
      return column;
    }),
  };

  // The AI itself is mocked here, at the network boundary the browser talks
  // to - the real backend and model are never involved in this test.
  await page.route("**/api/chat", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { messages: [] } });
      return;
    }
    await route.fulfill({
      json: { reply: `Moved "${movedCardTitle}" to Done.`, board: updatedBoard },
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /ai assistant/i }).click();

  const sidebar = page.getByLabel("AI assistant");
  await sidebar.getByLabel("Message").fill("Move the first backlog card to done");
  await sidebar.getByRole("button", { name: /^send$/i }).click();

  await expect(sidebar.getByText(`Moved "${movedCardTitle}" to Done.`)).toBeVisible();
  await expect(sidebar.getByText(/board updated/i)).toBeVisible();

  const doneColumn = page.getByTestId("column-col-done");
  const backlogColumn = page.getByTestId("column-col-backlog");
  await expect(doneColumn.getByText(movedCardTitle)).toBeVisible();
  await expect(backlogColumn.getByText(movedCardTitle)).not.toBeVisible();
});
