import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/shared/ui/misc";
import { ApiError } from "@/shared/api/client";
import { AppShell, PageFallback } from "./AppShell";
import { RequireAuth } from "./RequireAuth";
import { SignInPage } from "@/features/auth/SignInPage";
import { IdpPage } from "@/features/auth/IdpPage";
import { NotFound } from "./NotFound";

const HubPage = lazy(() => import("@/features/close-status/HubPage"));
const OverviewPage = lazy(() => import("@/features/close-status/OverviewPage"));
const ChecklistPage = lazy(() => import("@/features/checklist/ChecklistPage"));
const FluxPage = lazy(() => import("@/features/flux/FluxPage"));
const JournalsPage = lazy(() => import("@/features/journals/JournalsPage"));
const ContextNotesPage = lazy(() => import("@/features/ai-context/ContextNotesPage"));
const SetupPage = lazy(() => import("@/features/setup/SetupPage"));
const AuditPage = lazy(() => import("@/features/audit/AuditPage"));
const TracePage = lazy(() => import("@/features/audit/TracePage"));
const AccrualsPage = lazy(() => import("@/features/accruals/AccrualsPage"));
const RecognitionPage = lazy(() => import("@/features/recognition/RecognitionPage"));
const ConsolidationPage = lazy(() => import("@/features/consolidation/ConsolidationPage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/signin" element={<SignInPage />} />
            <Route path="/sso/idp" element={<IdpPage />} />
            <Route
              element={
                <RequireAuth>
                  <AppShell />
                </RequireAuth>
              }
            >
              <Route index element={<Navigate to="/hub" replace />} />
              <Route path="hub" element={<Lazy el={<HubPage />} />} />
              <Route path="e/:entityId">
                <Route index element={<Navigate to="overview" replace />} />
                <Route path="overview" element={<Lazy el={<OverviewPage />} />} />
                <Route path="checklist" element={<Lazy el={<ChecklistPage />} />} />
                <Route path="flux" element={<Lazy el={<FluxPage />} />} />
                <Route path="journals" element={<Lazy el={<JournalsPage />} />} />
                <Route path="accruals" element={<Lazy el={<AccrualsPage />} />} />
                <Route path="recognition" element={<Lazy el={<RecognitionPage />} />} />
              </Route>
              <Route path="context" element={<Lazy el={<ContextNotesPage />} />} />
              <Route path="consolidation" element={<Lazy el={<ConsolidationPage />} />} />
              <Route path="setup" element={<Lazy el={<SetupPage />} />} />
              <Route path="audit" element={<Lazy el={<AuditPage />} />} />
              <Route path="audit/trace/:draftId" element={<Lazy el={<TracePage />} />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <Toaster richColors position="bottom-right" closeButton />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function Lazy({ el }: { el: React.ReactNode }) {
  return <Suspense fallback={<PageFallback />}>{el}</Suspense>;
}
