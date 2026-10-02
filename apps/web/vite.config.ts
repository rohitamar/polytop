import { defineConfig } from "vite";

export default defineConfig({
  server: { proxy: { "/lobby": { target: `ws://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? 3001}`, ws: true } } },
});
