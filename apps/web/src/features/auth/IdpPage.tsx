import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { api, errorMessage } from "@/shared/api/client";
import { qk } from "@/shared/api/hooks";
import { Badge } from "@/shared/ui/badge";
import { Card } from "@/shared/ui/card";
import { Initials } from "@/shared/ui/domain";
import { Skeleton } from "@/shared/ui/misc";

interface DirUser {
  email: string;
  name: string;
  title: string;
  status: string;
}

/** Simulates the customer's identity provider (e.g. Okta) behind WorkOS. */
export function IdpPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dir = useQuery({ queryKey: ["idp-directory"], queryFn: () => api.get<DirUser[]>("/auth/idp-directory") });
  const next = params.get("next") ?? "/hub";

  async function choose(email: string) {
    setBusy(email);
    setError(null);
    try {
      await api.post("/auth/callback", { email, state: params.get("state") });
      await qc.invalidateQueries({ queryKey: qk.me });
      nav(next.startsWith("/") ? next : "/hub", { replace: true });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-[#eef1f6] p-4 dark:bg-canvas">
      <Card className="w-full max-w-lg p-6">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <KeyRound className="size-4" /> Northwind Okta <Badge variant="outline">simulated IdP</Badge>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">Choose a demo account. Each has different roles, so you can see segregation of duties in action (e.g. sign in as Priya to prepare, then Omar to approve).</p>
        {error ? (
          <p role="alert" className="mb-3 rounded-md bg-destructive/10 p-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <ul className="divide-y rounded-md border">
          {dir.isLoading
            ? Array.from({ length: 5 }).map((_, i) => (
                <li key={i} className="p-3">
                  <Skeleton className="h-8" />
                </li>
              ))
            : dir.data?.map((u) => (
                <li key={u.email}>
                  <button
                    className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted disabled:opacity-50"
                    onClick={() => choose(u.email)}
                    disabled={!!busy}
                  >
                    <Initials name={u.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{u.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {u.title} · {u.email}
                      </span>
                    </span>
                    {u.status === "invited" ? <Badge variant="info">Invited</Badge> : u.status === "deactivated" ? <Badge variant="destructive">Deactivated</Badge> : null}
                    {busy === u.email ? <span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" /> : null}
                  </button>
                </li>
              ))}
          <li>
            <button className="w-full p-3 text-left text-sm text-muted-foreground hover:bg-muted" onClick={() => choose("stranger@othercorp.example")} disabled={!!busy}>
              Sign in as someone who hasn't been provisioned…
            </button>
          </li>
        </ul>
      </Card>
    </div>
  );
}
