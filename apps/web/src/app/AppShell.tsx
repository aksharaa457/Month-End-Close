import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  BookCheck,
  Building2,
  CalendarClock,
  ChevronDown,
  ClipboardCheck,
  FileSpreadsheet,
  GitMerge,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  NotebookPen,
  RotateCcw,
  ScrollText,
  Settings2,
  Sparkles,
  Sun,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import { api } from "@/shared/api/client";
import { PERIOD, useEntities, useMe, useNotifications } from "@/shared/api/hooks";
import { cn } from "@/shared/lib/utils";
import { closeDay as fmtCloseDay, periodLabel } from "@/shared/lib/format";
import { roleLabel } from "@/shared/lib/labels";
import { applyTheme, getTheme } from "@/shared/lib/theme";
import { Button } from "@/shared/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Kbd, Skeleton } from "@/shared/ui/misc";
import { Initials, ReleaseTag } from "@/shared/ui/domain";
import { CopilotDialog } from "@/features/copilot/CopilotDialog";
import { ErrorBoundary } from "./ErrorBoundary";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  release?: "MVP" | "v1";
  entityScoped?: boolean;
}

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Close",
    items: [
      { to: "/hub", label: "Close status", icon: LayoutDashboard },
      { to: "overview", label: "Entity overview", icon: CalendarClock, entityScoped: true },
      { to: "checklist", label: "Checklist", icon: ClipboardCheck, entityScoped: true },
      { to: "flux", label: "Flux & variance", icon: TrendingUp, entityScoped: true },
      { to: "journals", label: "Journal entries", icon: BookCheck, entityScoped: true },
    ],
  },
  {
    group: "Modules",
    items: [
      { to: "accruals", label: "Accrual & prepaid", icon: Wallet, entityScoped: true, release: "v1" },
      { to: "recognition", label: "Revenue recognition", icon: FileSpreadsheet, entityScoped: true, release: "v1" },
      { to: "/consolidation", label: "Consolidation", icon: GitMerge, release: "v1" },
    ],
  },
  {
    group: "Governance",
    items: [
      { to: "/context", label: "AI context", icon: NotebookPen },
      { to: "/audit", label: "Audit trail", icon: ScrollText },
      { to: "/setup", label: "Setup & Enterprise Brain", icon: Settings2 },
    ],
  },
];

const LAST_ENTITY = "cch-last-entity";

export function PageFallback({ full }: { full?: boolean }) {
  return (
    <div className={cn("space-y-3 p-2", full && "p-8")} aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const loc = useLocation();
  const entityMatch = useMatch("/e/:entityId/*");
  const entities = useEntities();
  const routeEntity = entityMatch?.params.entityId;

  const [lastEntity, setLastEntity] = useState<string>(() => {
    try {
      return localStorage.getItem(LAST_ENTITY) ?? "e-us";
    } catch {
      return "e-us";
    }
  });
  useEffect(() => {
    if (routeEntity && routeEntity !== lastEntity) {
      setLastEntity(routeEntity);
      try {
        localStorage.setItem(LAST_ENTITY, routeEntity);
      } catch {
        /* ignore */
      }
    }
  }, [routeEntity, lastEntity]);
  const known = entities.data?.some((e) => e.id === lastEntity);
  const fallback = entities.data?.find((e) => e.status === "active")?.id ?? entities.data?.[0]?.id ?? lastEntity;
  const entityId = routeEntity ?? (entities.data && !known ? fallback : lastEntity);

  useEffect(() => {
    setMobileOpen(false);
  }, [loc.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCopilotOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sidebar = (
    <nav aria-label="Main" className="flex h-full flex-col gap-4 overflow-y-auto px-3 py-4">
      <Link to="/hub" className="flex items-center gap-2 px-2">
        <span className="grid size-8 place-items-center rounded-md bg-white/10">
          <Landmark className="size-4" />
        </span>
        <span className="font-display text-sm font-bold leading-tight">
          Continuous
          <br />
          Close Hub
        </span>
      </Link>
      {NAV.map((g) => (
        <div key={g.group}>
          <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-sidebar-muted">{g.group}</p>
          <ul className="space-y-0.5">
            {g.items.map((it) => {
              const to = it.entityScoped ? `/e/${entityId}/${it.to}` : it.to;
              return (
                <li key={it.label}>
                  <NavLink
                    to={to}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-sidebar-foreground/80 transition hover:bg-white/10 hover:text-sidebar-foreground",
                        isActive && "bg-white/15 font-medium text-sidebar-foreground",
                      )
                    }
                  >
                    <it.icon className="size-4 shrink-0" />
                    <span className="flex-1 truncate">{it.label}</span>
                    {it.release ? <ReleaseTag release={it.release} /> : null}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div className="mt-auto rounded-md bg-white/5 p-2.5 text-[11px] leading-relaxed text-sidebar-muted">
        <p className="font-semibold text-sidebar-foreground">Demo mode</p>
        Mock API in your browser. Data is fictional and saved locally.
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only z-50 rounded bg-card px-3 py-2 focus:not-sr-only focus:fixed focus:left-2 focus:top-2">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 bg-sidebar text-sidebar-foreground lg:block">{sidebar}</aside>
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-sidebar text-sidebar-foreground shadow-xl">
            <button className="absolute right-2 top-3 rounded p-1 text-sidebar-foreground" onClick={() => setMobileOpen(false)} aria-label="Close menu">
              <X className="size-4" />
            </button>
            {sidebar}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur sm:px-5">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu />
          </Button>
          <EntitySwitcher entityId={entityId} entities={entities.data ?? []} scoped={!!routeEntity} />
          <div className="hidden items-center gap-1.5 rounded-md border px-2 py-1 text-xs md:flex">
            <CalendarClock className="size-3.5 text-muted-foreground" />
            <span className="font-medium">{periodLabel(PERIOD)}</span>
            <span className="text-muted-foreground">· today {fmtCloseDay(4)} (4 Sep 2026)</span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ai" size="sm" onClick={() => setCopilotOpen(true)} className="gap-1.5">
              <Sparkles /> <span className="hidden sm:inline">Ask AI</span>
              <span className="hidden opacity-70 sm:inline">
                <Kbd>⌘K</Kbd>
              </span>
            </Button>
            <Notifications />
            <UserMenu />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 sm:px-6">
          <ErrorBoundary key={loc.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      <CopilotDialog open={copilotOpen} onOpenChange={setCopilotOpen} entityId={entityId} />
    </div>
  );
}

function EntitySwitcher({ entityId, entities, scoped }: { entityId: string; entities: { id: string; name: string; status: string; region: string }[]; scoped: boolean }) {
  const nav = useNavigate();
  const loc = useLocation();
  const current = entities.find((e) => e.id === entityId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-[16rem] justify-start gap-2" aria-label="Choose entity">
          <Building2 className="text-muted-foreground" />
          <span className="truncate">{current?.name ?? "Choose entity"}</span>
          <ChevronDown className="ml-auto opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Entity {scoped ? "" : "(used by entity pages)"}</DropdownMenuLabel>
        {entities.map((e) => (
          <DropdownMenuItem
            key={e.id}
            onSelect={() => {
              if (scoped) nav(loc.pathname.replace(/^\/e\/[^/]+/, `/e/${e.id}`));
              else nav(`/e/${e.id}/overview`);
            }}
          >
            <Building2 />
            <div className="min-w-0 flex-1">
              <div className="truncate">{e.name}</div>
              <div className="text-[11px] text-muted-foreground">{e.region}</div>
            </div>
            {e.status === "setup_required" ? <span className="text-[10px] uppercase text-muted-foreground">Set up</span> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Notifications() {
  const n = useNotifications();
  const items = n.data ?? [];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notifications (${items.length})`} className="relative">
          <Bell />
          {items.length ? <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">{items.length}</span> : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[70vh] w-80 overflow-y-auto">
        <DropdownMenuLabel>Needs your attention</DropdownMenuLabel>
        {items.length === 0 ? <p className="px-2 py-3 text-sm text-muted-foreground">You're all caught up.</p> : null}
        {items.map((it) => (
          <DropdownMenuItem key={it.id} asChild>
            <Link to={it.link} className="items-start">
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", it.kind === "overdue_task" || it.kind === "sync_failed" ? "bg-destructive" : it.kind === "approval_needed" ? "bg-warning" : "bg-ai")} />
              <span className="text-[13px] leading-snug">{it.text}</span>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const me = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [theme, setTheme] = useState(getTheme());
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  if (!me.data) return null;
  const u = me.data.user;
  const roles = [...new Set(u.memberships.map((m) => roleLabel[m.role] + (m.entityId ? ` (${m.entityId.replace("e-", "").toUpperCase()})` : "")))];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2 px-1.5" aria-label="Account menu">
          <Initials name={u.name} />
          <span className="hidden text-left leading-tight md:block">
            <span className="block text-xs font-semibold">{u.name}</span>
            <span className="block text-[11px] text-muted-foreground">{roles.join(", ")}</span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          {u.name} · {u.title}
          <br />
          {me.data.tenant.name}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? <Sun /> : <Moon />} {theme === "dark" ? "Light mode" : "Dark mode"}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={async () => {
            await api.post("/demo/reset");
            await qc.invalidateQueries();
            // The real backend's reset also clears sessions; the auth guard then sends you to sign in.
          }}
        >
          <RotateCcw /> Reset demo data
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            await api.post("/auth/logout");
            qc.clear();
            nav("/signin");
          }}
        >
          <LogOut /> Sign out / switch user
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
