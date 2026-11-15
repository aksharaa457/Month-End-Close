import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // With VITE_USE_MOCK_API=false the app talks to the FastAPI backend through this
  // proxy, so session cookies stay same-origin (apps/api: uvicorn on :8001).
  server: { port: 5173, proxy: { "/api": { target: "http://localhost:8001", changeOrigin: false } } },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
} as never);
