import { expect, test, type Locator, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.request.post("/api/login", {
    data: { username: "user", password: "password" },
  });
});

// See kanban.spec.ts for why titles need a random suffix (no reset endpoint,
// one real persisted board shared by every run) and why button lookups use a
// CSS attribute selector instead of getByRole (the card's sortable article is
// itself role="button", so getByRole("button", { name }) also matches it).
const uniqueTitle = (base: string) =>
  `${base} ${Math.random().toString(36).slice(2, 8)}`;
const deleteButton = (scope: Locator | Page, title: string) =>
  scope.locator(`button[aria-label="Delete ${title}"]`);
const editButton = (scope: Locator | Page, title: string) =>
  scope.locator(`button[aria-label="Edit ${title}"]`);

// Every mutation's PUT fires fire-and-forget (see KanbanBoard.tsx's
// applyAndSave - rename is additionally debounced 500ms before it fires at
// all). This test's whole point is "does it survive a reload", so each
// mutation's save must be awaited before the next step - otherwise a reload
// could race ahead of a pending PUT and this test would fail for the wrong
// reason (or, worse, pass by accident).
const waitForBoardSave = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.url().includes("/api/board") && response.request().method() === "PUT"
  );

test("every kind of change survives a page reload", async ({ page }) => {
  await page.goto("/");

  const firstColumn = page.locator('[data-testid^="column-"]').first();
  const titleInput = firstColumn.getByLabel("Column title");
  const originalTitle = await titleInput.inputValue();
  const renamedTitle = uniqueTitle("Reload-tested column");
  let saved = waitForBoardSave(page);
  await titleInput.fill(renamedTitle);
  await saved;

  const cardTitle = uniqueTitle("Reload card");
  const editedTitle = `${cardTitle} edited`;
  const deleteMeTitle = uniqueTitle("Card to delete");

  saved = waitForBoardSave(page);
  await firstColumn.getByRole("button", { name: /add a card/i }).click();
  await firstColumn.getByPlaceholder("Card title").fill(cardTitle);
  await firstColumn.getByPlaceholder("Details").fill("Original details.");
  await firstColumn.getByRole("button", { name: /add card/i }).click();
  await expect(firstColumn.getByText(cardTitle)).toBeVisible();
  await saved;

  // hasText matches text content, not input values, so it stops matching once
  // the card switches to its edit form - resolve the stable data-testid first.
  const reloadCardTestId = await firstColumn
    .locator('[data-testid^="card-"]', { hasText: cardTitle })
    .getAttribute("data-testid");
  const reloadCard = page.getByTestId(reloadCardTestId!);

  saved = waitForBoardSave(page);
  await editButton(reloadCard, cardTitle).click();
  await reloadCard.getByLabel(`Edit title for ${cardTitle}`).fill(editedTitle);
  await reloadCard.getByLabel(`Edit details for ${cardTitle}`).fill("Edited details.");
  await reloadCard.getByRole("button", { name: /^save$/i }).click();
  await expect(firstColumn.getByText(editedTitle)).toBeVisible();
  await saved;

  // Prove a delete survives a reload too - added and removed here, before the
  // drag below, rather than after it: a fresh UI interaction on this column
  // immediately following a drag out of it has proven flaky (dnd-kit's drag
  // teardown appears not to be fully settled the instant mouse.up() resolves).
  saved = waitForBoardSave(page);
  await firstColumn.getByRole("button", { name: /add a card/i }).click();
  await firstColumn.getByPlaceholder("Card title").fill(deleteMeTitle);
  await firstColumn.getByPlaceholder("Details").fill("Should not survive.");
  await firstColumn.getByRole("button", { name: /add card/i }).click();
  await saved;
  saved = waitForBoardSave(page);
  await deleteButton(firstColumn, deleteMeTitle).click();
  await expect(firstColumn.getByText(deleteMeTitle)).not.toBeVisible();
  await saved;

  // The drag is the last mutation before reload, so nothing else touches the
  // page in between.
  const targetColumn = page.getByTestId("column-col-review");
  const card = firstColumn.locator('[data-testid^="card-"]', { hasText: editedTitle });
  const cardBox = await card.boundingBox();
  const columnBox = await targetColumn.boundingBox();
  if (!cardBox || !columnBox) {
    throw new Error("Unable to resolve drag coordinates.");
  }
  saved = waitForBoardSave(page);
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(columnBox.x + columnBox.width / 2, columnBox.y + 120, {
    steps: 12,
  });
  await page.mouse.up();
  const movedCard = targetColumn.locator('[data-testid^="card-"]', { hasText: editedTitle });
  await expect(movedCard).toBeVisible();
  await saved;

  await page.reload();

  await expect(
    page.locator('[data-testid^="column-"]').first().getByLabel("Column title")
  ).toHaveValue(renamedTitle);
  const movedCardAfterReload = page
    .getByTestId("column-col-review")
    .locator('[data-testid^="card-"]', { hasText: editedTitle });
  await expect(movedCardAfterReload).toBeVisible();
  await expect(movedCardAfterReload).toContainText("Edited details.");
  await expect(page.getByText(deleteMeTitle)).not.toBeVisible();

  saved = waitForBoardSave(page);
  await deleteButton(page.getByTestId("column-col-review"), editedTitle).click();
  await expect(page.getByText(editedTitle)).not.toBeVisible();
  await saved;

  const restored = waitForBoardSave(page);
  await page
    .locator('[data-testid^="column-"]')
    .first()
    .getByLabel("Column title")
    .fill(originalTitle);
  await restored;
});
