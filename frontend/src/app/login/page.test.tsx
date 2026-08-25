import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/app/login/page";
import * as api from "@/lib/api";

describe("LoginPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { location?: Location }).location;
    window.location = { href: "" } as Location;
  });

  it("shows an error on failed login and does not navigate", async () => {
    vi.spyOn(api, "login").mockRejectedValue(new Error("bad credentials"));
    render(<LoginPage />);

    await userEvent.type(screen.getByLabelText("Username"), "user");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /invalid username or password/i
    );
    expect(window.location.href).toBe("");
  });

  it("navigates to / on successful login", async () => {
    vi.spyOn(api, "login").mockResolvedValue(undefined);
    render(<LoginPage />);

    await userEvent.type(screen.getByLabelText("Username"), "user");
    await userEvent.type(screen.getByLabelText("Password"), "password");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(window.location.href).toBe("/");
  });
});
