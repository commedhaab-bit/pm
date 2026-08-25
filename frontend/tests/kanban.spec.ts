import { expect, test, type Locator, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.request.post("/api/login", {
    data: { username: "user", password: "password" },
  });
});

// The board is one real, persisted row shared by every test run (there's no
// reset endpoint - see AGENTS.md). A suffix keeps titles unique even if an
// earlier failed run left orphaned data behind, so a fresh run never collides
// with it.
const uniqueTitle = (base: string) =>
  `${base} ${Math.random().toString(36).slice(2, 8)}`;

// A card's whole article has role="button" (it's the dnd-kit drag handle), so
// getByRole("button", { name }) also matches the article itself - its
// accessible name is computed from its content, which includes the actual
// button's own aria-label as a substring. A plain CSS attribute selector
// avoids that ambiguity entirely.
const editButton = (scope: Locator | Page, title: string) =>
  scope.locator(`button[aria-label="Edit ${title}"]`);
const deleteButton = (scope: Locator | Page, title: string) =>
  scope.locator(`button[aria-label="Delete ${title}"]`);

// Column rename is debounced (500ms) before it's actually PUT to the server,
// and Playwright tears the page down right after the test function returns -
// so a rename made near the end of a test needs to be explicitly waited on,
// or it never gets saved at all.
const waitForBoardSave = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.url().includes("/api/board") && response.request().method() === "PUT"
  );

const addCard = async (page: Page, column: Locator, title: string, details: string) => {
  const saved = waitForBoardSave(page);
  await column.getByRole("button", { name: /add a card/i }).click();
  await column.getByPlaceholder("Card title").fill(title);
  await column.getByPlaceholder("Details").fill(details);
  await column.getByRole("button", { name: /add card/i }).click();
  await expect(column.getByText(title)).toBeVisible();
  await saved;
};

test("loads the kanban board", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
});

test("renames a column and restores it", async ({ page }) => {
  await page.goto("/");
  const firstColumn = page.locator('[data-testid^="column-"]').first();
  const titleInput = firstColumn.getByLabel("Column title");
  const originalTitle = await titleInput.inputValue();

  await titleInput.fill("Renamed Column");
  await expect(titleInput).toHaveValue("Renamed Column");

  const restored = waitForBoardSave(page);
  await titleInput.fill(originalTitle);
  await expect(titleInput).toHaveValue(originalTitle);
  await restored;
});

test("adds, edits, and deletes a card", async ({ page }) => {
  await page.goto("/");
  const firstColumn = page.locator('[data-testid^="column-"]').first();
  const title = uniqueTitle("Playwright card");
  const editedTitle = `${title} edited`;
  await addCard(page, firstColumn, title, "Added via e2e.");

  // hasText matches text content, not input values, so it stops matching once
  // the card switches to its edit form - resolve the stable data-testid first.
  const cardTestId = await firstColumn
    .locator('[data-testid^="card-"]', { hasText: title })
    .getAttribute("data-testid");
  const card = page.getByTestId(cardTestId!);

  const edited = waitForBoardSave(page);
  await editButton(card, title).click();
  await card.getByLabel(`Edit title for ${title}`).fill(editedTitle);
  await card.getByRole("button", { name: /^save$/i }).click();
  await expect(firstColumn.getByText(editedTitle)).toBeVisible();
  await edited;

  // Wait for the delete's PUT to actually land - Playwright tears the page
  // down right after the test ends, which can abort a still-in-flight fetch
  // and leave the card orphaned in the real, persisted board.
  const deleted = waitForBoardSave(page);
  await deleteButton(firstColumn, editedTitle).click();
  await expect(firstColumn.getByText(editedTitle)).not.toBeVisible();
  await deleted;
});

test("moves a card between columns", async ({ page }) => {
  await page.goto("/");
  const sourceColumn = page.locator('[data-testid^="column-"]').first();
  const title = uniqueTitle("Draggable card");
  await addCard(page, sourceColumn, title, "Move me.");

  const card = page.locator('[data-testid^="card-"]', { hasText: title }).first();
  const targetColumn = page.getByTestId("column-col-review");
  const cardBox = await card.boundingBox();
  const columnBox = await targetColumn.boundingBox();
  if (!cardBox || !columnBox) {
    throw new Error("Unable to resolve drag coordinates.");
  }

  let saved = waitForBoardSave(page);
  await page.mouse.move(
    cardBox.x + cardBox.width / 2,
    cardBox.y + cardBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    columnBox.x + columnBox.width / 2,
    columnBox.y + 120,
    { steps: 12 }
  );
  await page.mouse.up();

  const movedCard = targetColumn.locator('[data-testid^="card-"]', { hasText: title });
  await expect(movedCard).toBeVisible();
  await saved;

  // Wait for the delete's PUT to actually land - Playwright tears the page
  // down right after the test ends, which can abort a still-in-flight fetch
  // and leave the card orphaned in the real, persisted board.
  saved = waitForBoardSave(page);
  await deleteButton(targetColumn, title).click();
  await expect(targetColumn.getByText(title)).not.toBeVisible();
  await saved;
});
