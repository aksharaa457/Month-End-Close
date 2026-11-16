import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { App } from "./app/App";

async function boot() {
  // The FastAPI backend doesn't exist yet: an in-browser mock API (MSW) serves
  // /api/v1 with the same contract and rules. Set VITE_USE_MOCK_API=false to
  // point the app at a real backend instead.
  if (import.meta.env.VITE_USE_MOCK_API !== "false") {
    const { startMockApi } = await import("./mocks/browser");
    await startMockApi();
  }
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void boot();
