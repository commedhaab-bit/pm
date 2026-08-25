import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.request.post("/api/login", {
    data: { username: "user", password: "password" },
  });
});

test(
  "the assistant moves a card on request, against the real model",
  { tag: "@live" },
  async ({ page }) => {
    const boardResponse = await page.request.get("/api/board");
    const board = await boardResponse.json();
    const backlog = board.columns.find((c: { id: string }) => c.id === "col-backlog");
    const cardId: string = backlog.cardIds[0];
    const cardTitle: string = board.cards[cardId].title;

    await page.goto("/");
    await page.getByRole("button", { name: /ai assistant/i }).click();

    const sidebar = page.getByLabel("AI assistant");
    await sidebar
      .getByLabel("Message")
      .fill(
        `Move the card titled "${cardTitle}" from Backlog to the Done column.`
      );
    await sidebar.getByRole("button", { name: /^send$/i }).click();

    await expect(sidebar.getByText(/board updated/i)).toBeVisible({
      timeout: 30_000,
    });

    let doneColumn = page.getByTestId("column-col-done");
    await expect(doneColumn.getByText(cardTitle)).toBeVisible();

    // Unlike chat.spec.ts (which mocks the AI and never touches the real
    // backend), this hit the real /api/chat route, which really persists the
    // board - so a reload should show the same result, not just the
    // in-memory client state.
    await page.reload();
    doneColumn = page.getByTestId("column-col-done");
    await expect(doneColumn.getByText(cardTitle)).toBeVisible();

    // Restore the seed layout so this real, shared board isn't left mutated.
    await page.request.put("/api/board", { data: board });
  }
);
