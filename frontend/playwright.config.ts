import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PW_BASE_URL ?? "http://localhost:8000";
const isLocalDevServer = baseURL.includes("127.0.0.1:3000");

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: isLocalDevServer
    ? {
        command: "npm run dev -- --hostname 127.0.0.1 --port 3000",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      }
    : undefined,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
