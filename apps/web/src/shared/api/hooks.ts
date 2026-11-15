import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, errorMessage } from "./client";
import type { CloseSummary, Entity, Job, Me, Notification, Permission, User } from "./types";

export const PERIOD = "2026-08";

export const qk = {
  me: ["me"] as const,
  entities: ["entities"] as const,
  users: ["users"] as const,
  summary: ["close-summary", PERIOD] as const,
  notifications: ["notifications"] as const,
  period: (e: string) => ["period", e, PERIOD] as const,
  tasks: (e: string) => ["tasks", e, PERIOD] as const,
  flux: (e: string) => ["flux", e, PERIOD] as const,
  drafts: (e: string) => ["drafts", e, PERIOD] as const,
  contextNotes: ["context-notes"] as const,
  comments: (t: string, id: string) => ["comments", t, id] as const,
};

export function useMe() {
  return useQuery({ queryKey: qk.me, queryFn: () => api.get<Me>("/me"), retry: false, staleTime: 60_000 });
}
export function useEntities() {
  return useQuery({ queryKey: qk.entities, queryFn: () => api.get<Entity[]>("/entities"), staleTime: 30_000 });
}
export function useUsers() {
  return useQuery({ queryKey: qk.users, queryFn: () => api.get<User[]>("/users"), staleTime: 30_000 });
}
export function useCloseSummary() {
  return useQuery({ queryKey: qk.summary, queryFn: () => api.get<CloseSummary>("/close/summary") });
}
export function useNotifications() {
  return useQuery({ queryKey: qk.notifications, queryFn: () => api.get<Notification[]>("/notifications"), refetchInterval: 60_000 });
}

/** Permission check against GET /me. The server always re-checks (ARCH §3.2). */
export function useCan() {
  const { data } = useMe();
  return (perm: Permission, entityId?: string | null) => {
    if (!data) return false;
    const p = data.permissions;
    if (p["*"]?.includes(perm)) return true;
    if (entityId) return !!p[entityId]?.includes(perm);
    return Object.values(p).some((x) => x.includes(perm));
  };
}

export function useUserName() {
  const { data } = useUsers();
  return (id: string | null | undefined) => (id ? data?.find((u) => u.id === id)?.name ?? "…" : "System");
}

/**
 * Pessimistic mutation for financial actions: the UI waits for the server and
 * then invalidates related queries. Errors surface the server's problem detail.
 */
export function useAction<TVars, TRes = unknown>(
  fn: (v: TVars) => Promise<TRes>,
  opts: { invalidate?: QueryKey[]; success?: string | ((r: TRes) => string); onSuccess?: (r: TRes) => void } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      (opts.invalidate ?? []).forEach((k) => qc.invalidateQueries({ queryKey: k }));
      qc.invalidateQueries({ queryKey: qk.summary });
      qc.invalidateQueries({ queryKey: qk.notifications });
      const msg = typeof opts.success === "function" ? opts.success(r) : opts.success;
      if (msg) toast.success(msg);
      opts.onSuccess?.(r);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

/** Polls a background job until it finishes (ARCH §3.3; polling fallback for SSE). */
export function useJob(jobId: string | null, onDone?: (job: Job) => void) {
  const done = useRef<string | null>(null);
  const q = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.get<Job>(`/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (query) => (query.state.data && ["succeeded", "failed"].includes(query.state.data.status) ? false : 400),
  });
  useEffect(() => {
    if (q.data && jobId && done.current !== jobId && ["succeeded", "failed"].includes(q.data.status)) {
      done.current = jobId;
      onDone?.(q.data);
    }
  }, [q.data, jobId, onDone]);
  return q.data ?? null;
}
