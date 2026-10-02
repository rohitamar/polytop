import { defineConfig } from "vite";

export default defineConfig({
  server: { proxy: { "/lobby": { target: "ws://127.0.0.1:3001", ws: true } } },
});
