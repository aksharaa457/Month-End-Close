# Continuous Close Hub: web app

React 18 + TypeScript + Vite, TanStack Query/Table/Virtual, shadcn-style components on Radix, Tailwind, Recharts, React Hook Form + Zod. This matches [TECH-STACK.md](../../TECH-STACK.md).

## Run it

```bash
cd apps/web
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest)
npm run build      # type-check + production build
```

## Mock API

The FastAPI backend doesn't exist yet. Instead, an **in-browser mock API** ([MSW](https://mswjs.io)) serves `/api/v1/*`.
- **Same contract and rules:** the endpoints follow [ARCHITECTURE.md §5](../../ARCHITECTURE.md), and the mock enforces the same server-side rules: segregation of duties, period lock, balancing, idempotency keys, CSRF and permissions.
- **Saved state:** demo state is saved in your browser's localStorage. Reset it from the account menu → **Reset demo data**.
- **Fictional data:** all data, including Northwind Holdings and its customers and vendors, is made up.
- **Switching to the real API:** set `VITE_USE_MOCK_API=false` to point the app at a real backend. The screens don't change.

Code layout:

| Path | What |
|---|---|
| `src/shared/api/types.ts` | API contract types. To be replaced by the client generated from OpenAPI |
| `src/mocks/` | Mock DB (`db.ts`), server rules (`logic.ts`) and HTTP handlers |
| `src/features/*` | One folder per product area |
| `src/shared/ui/` | Components (`domain.tsx` has AI panels, chart cards with a table fallback, and reason dialogs) |

## Demo accounts

Sign in → **Continue with SSO** → choose a person. Each has different roles, so you can see segregation of duties in action:

| Person | Roles | Try |
|---|---|---|
| Priya Sharma | Preparer | Propose AI context, generate and submit JEs, work the checklist |
| Omar Haddad | Reviewer + Approver | Sign off tasks and variances, approve JEs (not ones he prepared) |
| Daniel Chen | Approver | Give the second approval on large JEs |
| Maria Lopez | Controller | Approve material AI context, lock periods, consolidation, auto-apply policy |
| Grace Okafor | Controller (CFO) | Second approver for policy changes and reopens |
| Ravi Kumar | Preparer + Reviewer (India only) | Entity-scoped access |
| Sam Patel | Admin | Connections, mapping, users |
| Ellen Brooks | Auditor (read-only) | Audit trail, trace, export |
| Lena Novak | Invited | First sign-in activates the invitation |

## Where each PRD feature is

| PRD | Screen |
|---|---|
| F1 Enterprise Brain (EB-1..5, US-1..5) | Setup → Connections, Account mapping, Sources |
| F2 Close status (HUB-1..5, OV-1..6) | Close status (`/hub`), Entity overview |
| F3 Checklist (CL-1..8) | Checklist + task drawer |
| F4 Flux (FX-1..4, FX-7, FX-8) | Flux & variance + variance drawer |
| F5 AI context (FX-5, FX-6, §10.2) | Variance drawer → AI context tab; AI context page |
| F6 Journal entries (JE-1..7) | Journal entries + entry drawer |
| F7 Controls & audit (US-22..24, §10) | Period lock on the overview; Audit trail; trace view |
| Thresholds & approval policy (FX-2, JE-4) | Setup → Thresholds, Approvals |
| F8 Accruals (v1) | Accrual & prepaid |
| F9 Recognition + auto-apply (v1, §10.1) | Revenue recognition |
| F10 Ask AI (v1) | ⌘K / "Ask AI" |
| F11 Consolidation (v1) | Consolidation |
| CL-6 Notifications (v1) | Bell in the top bar |

## A 5-minute demo

1. **Priya**: on Flux & variance, open **Recurring Revenue**. Under **AI context**, add "billing occurs every 45 days" and note that it's only a preview. Then click **Draft JEs for N flagged lines**.
2. **Priya**: on Journal entries → Drafts, open a draft and submit it.
3. **Omar**: try to approve the context note. He can't: it changes a material conclusion, so it needs a Controller.
4. **Maria**: approve it on the AI context page. The Recurring Revenue explanation is rewritten.
5. **Omar**: approve the submitted entries in a batch. They post with ERP document numbers. JE-1001 ($354,800) waits for a second approver.
6. **Ellen**: on the Audit trail, verify the hash chain and open the trace for a posted entry.
