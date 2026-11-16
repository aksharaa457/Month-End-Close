import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Landmark, ShieldCheck } from "lucide-react";
import { api, errorMessage } from "@/shared/api/client";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";

export function SignInPage() {
  const [params] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error"));
  const next = params.get("next") ?? "/hub";

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const { redirectUrl } = await api.get<{ redirectUrl: string }>("/auth/login");
      window.location.assign(`${redirectUrl}&next=${encodeURIComponent(next)}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-canvas p-4">
      <Card className="w-full max-w-md p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-md bg-primary text-primary-foreground">
            <Landmark className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-bold">Continuous Close Hub</h1>
            <p className="text-xs text-muted-foreground">Month-end close for multi-entity finance teams</p>
          </div>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">Sign in with your company's single sign-on. Your identity provider handles passwords and multi-factor login.</p>
        <Button className="w-full" size="lg" onClick={start} loading={busy}>
          <ShieldCheck /> Continue with SSO
        </Button>
        {error ? (
          <p role="alert" className="mt-3 rounded-md bg-destructive/10 p-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">
          Demo: sign-in goes through a simulated WorkOS + identity provider step (ARCHITECTURE §6.1). Real sessions use HttpOnly cookies set by the API.
        </p>
      </Card>
    </div>
  );
}
