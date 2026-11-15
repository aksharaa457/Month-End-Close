import type { Problem } from "./types";

/**
 * Thin typed HTTP client for /api/v1. Replaced later by the client generated
 * from the FastAPI OpenAPI spec. Every write carries an Idempotency-Key and the
 * CSRF header (ARCHITECTURE §5.1, §6.2). Cookies carry the session.
 */
export class ApiError extends Error {
  constructor(public problem: Problem) {
    super(problem.detail ?? problem.title);
  }
  get status() {
    return this.problem.status;
  }
}

const BASE = "/api/v1";

function csrfToken() {
  try {
    return document.cookie.split("; ").find((c) => c.startsWith("cch_csrf="))?.split("=")[1] ?? "";
  } catch {
    return "";
  }
}

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2);
}

async function request<T>(method: string, path: string, body?: unknown, opts: { idempotencyKey?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") {
    headers["Idempotency-Key"] = opts.idempotencyKey ?? newKey();
    headers["X-CSRF-Token"] = csrfToken();
  }
  const res = await fetch(BASE + path, {
    method,
    headers,
    credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new ApiError(
      data && typeof data === "object" && "title" in data
        ? (data as Problem)
        : { type: "about:blank", title: res.statusText || "Request failed", status: res.status },
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown, idempotencyKey?: string) => request<T>("POST", path, body ?? {}, { idempotencyKey }),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
};

/** Reads a text/event-stream response (SSE over fetch). Used for copilot streaming. */
export async function streamSSE(path: string, body: unknown, onEvent: (event: string, data: string) => void) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", "X-CSRF-Token": csrfToken(), "Idempotency-Key": newKey() },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const t = await res.text();
    throw new ApiError(t ? JSON.parse(t) : { type: "about:blank", title: "Stream failed", status: res.status });
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      onEvent(event, data.join("\n"));
    }
  }
}

export function errorMessage(err: unknown) {
  if (err instanceof ApiError) return err.problem.detail ?? err.problem.title;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
