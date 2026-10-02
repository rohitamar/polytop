import { defineConfig } from "@playwright/test";

const serverPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "3001";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL,
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: { args: ["--enable-unsafe-swiftshader"] },
  },
  webServer: [{
    command: `npm run dev:web -- --strictPort --port ${new URL(baseURL).port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  }, {
    command: "npm run start -w @reach/server",
    env: { PORT: serverPort, MATCH_SEED: "fern-104", MATCH_SCENARIO: "demo" },
    url: `http://127.0.0.1:${serverPort}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  }],
  reporter: [["list"], ["html", { open: "never" }]],
});
