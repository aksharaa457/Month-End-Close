import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";
import { db } from "./db";
import { setCsrf } from "./handlers/core";

export async function startMockApi() {
  // Restore the CSRF cookie for a persisted demo session.
  if (db().session) setCsrf(`csrf-${db().session!.userId}`);
  const worker = setupWorker(...handlers);
  await worker.start({ onUnhandledRequest: "bypass", quiet: true });
}
