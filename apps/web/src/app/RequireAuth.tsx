import { Navigate, useLocation } from "react-router-dom";
import { useMe } from "@/shared/api/hooks";
import { PageFallback } from "./AppShell";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const loc = useLocation();
  if (me.isLoading) return <PageFallback full />;
  if (me.isError || !me.data) return <Navigate to={`/signin?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}
