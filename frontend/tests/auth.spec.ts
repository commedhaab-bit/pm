import { expect, test } from "@playwright/test";

test("redirects to /login when not signed in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("shows an error on bad credentials and stays on the login page", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: /sign in/i }).click();

  await expect(
    page.getByText(/invalid username or password/i)
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("signs in, reaches the board, signs out, and cannot go back", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: /sign in/i }).click();

  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);

  await page.getByRole("button", { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/login$/);
});
