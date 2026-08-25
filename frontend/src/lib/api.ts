export class UnauthorizedError extends Error {
  constructor() {
    super("Not authenticated");
  }
}

export const apiFetch = async (path: string, init?: RequestInit) => {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (response.status === 401) {
    throw new UnauthorizedError();
  }

  return response;
};

export const login = async (username: string, password: string) => {
  const response = await apiFetch("/api/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    throw new Error("Invalid username or password");
  }
};

export const logout = async () => {
  await apiFetch("/api/logout", { method: "POST" });
};

export const getCurrentUser = async (): Promise<{ username: string } | null> => {
  try {
    const response = await apiFetch("/api/me");
    if (!response.ok) {
      throw new Error(`Unexpected response from /api/me: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return null;
    }
    throw error;
  }
};
