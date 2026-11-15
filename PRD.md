# PRD: Continuous Close Hub

| | |
|---|---|
| **Status** | Draft v2.0 |
| **Date** | 15 Nov 2026 |
| **Owner** | TBD (Product) |
| **Reviewers** | Engineering lead, Controller / Finance SME, Internal Audit |
| **Sources** | CFO Suite demo video transcript (`WhatsApp Video 2026-10-06 at 20.06.18.txt`), the prototype in this repo, the product decisions in [§15](#15-decisions-risks-and-open-questions), and the research in [§16](#16-references) |

**How to read this document:**
- **Release tags.** **MVP** is what the first design-partner pilot needs to run a real close in-app. **v1** is the first general release after the MVP. **Later** means not yet scheduled.
- **Proposed** marks behaviour suggested by product but not yet confirmed. All of it is listed in §15 for confirmation.
- Where something is unknown, this document says so and does not guess.

---

## 1. Summary

Continuous Close Hub is a SaaS month-end close application for **multi-entity, mid-market finance teams** that run their close today on spreadsheets, email and ERP reports.

A single AI data layer, the **Enterprise Brain**, connects to each entity's ledger (NetSuite or SAP) and to its source systems. It reconciles them into one consistent view. On that view, the product runs the close:
- a checklist with AI-verified tasks
- flux and variance review with AI explanations that learn from business context
- AI-drafted journal entries that post to the ERP only after a person approves them

**The aim is to make the close shorter.** The AI does the preparation work: it detects, explains, verifies and drafts. **A person approves anything that touches the ledger.**

---

## 2. Problem statement

**Problem:** finance teams at multi-entity, mid-market companies take too long to close the books each month, because most of the close is manual prep work done in spreadsheets and email before any real review can start.

| What happens today | Why it slows the close |
|---|---|
| Close status lives in a shared spreadsheet and in email threads | Nobody can see the critical path or which entity is behind until it is already late |
| Data has to be pulled from each ERP and tied out by hand, and the pilot target spans NetSuite **and** SAP | Review can't start until the tie-out is done, and that tie-out is repeated for every entity |
| Variances are explained from scratch every month | Known patterns, such as "billing occurs every 45 days", get re-investigated and re-written every close |
| Corrections, reclasses and accruals are keyed in by hand after the review | Each finding needs another round: draft the entry, get approval, post it |
| Control evidence (who did what, and on what basis) is spread across files and inboxes | Sign-off and audit prep add more days at the end |

**Evidence and baseline:**
- The widely cited APQC benchmark puts the median monthly close at about **6 calendar days**, with the bottom quartile at **10 days or more**. See §16.
- The pilot's own days-to-close is **not yet known**. It will be measured from the design partner's last 3 closes during onboarding (D13). This document makes no claim about how slow the pilot is today.

**Why now:** current AI models can explain variances and draft entries from ledger data well enough to be useful. Auditors, though, expect a clear split between the AI, which prepares, and the human, who approves (§16). The product is built around that split.

---

## 3. Target users

### 3.1 Target market

| | |
|---|---|
| **Segment** | Multi-entity, mid-market companies that run the close in spreadsheets and email, with no dedicated close tool (decision D14) |
| **ERP** | NetSuite and/or SAP. Both are supported from the MVP (D1) |
| **Geography** | Multi-region groups. The demo data covers the US, India, the UAE and the EU |
| **Reporting** | US GAAP at group level (D10) |
| **Pilot** | One design partner, **not yet chosen**. The MVP is sized for **3–10 entities** and a close team of **5–20 users** (D12) |
| **Not targeted (v1)** | Teams that want to keep BlackLine or FloQast as their system of record; we don't build coexistence or migration from those tools (D14). Single-entity companies are not excluded, but nothing is designed for them specifically |

**Not yet defined:** pricing, packaging and self-serve sign-up. These are out of scope for this PRD.

### 3.2 Personas

| Persona | Role in the close | Main pain today | Gets from the product | Release |
|---|---|---|---|---|
| **Controller / Close owner** (primary user, likely buyer) | Runs the close calendar, unblocks the critical path, signs off | Can't see status across entities without chasing people | Live status per entity, AI-verified tasks, period lock | MVP |
| **Staff / Senior accountant** | Completes tasks, reviews variances, prepares entries | Hours of tie-out and re-writing the same explanations | AI explanations, reusable AI context, drafted JEs | MVP |
| **Approver (Manager / Controller)** | Approves variance sign-offs and JEs | Approves from screenshots and spreadsheets with weak evidence | Each entry linked to its variance line and ledger data; batch approval | MVP |
| **Admin** | Connects ERPs, maps accounts, manages users and thresholds | – | Setup wizard, sync health, roles | MVP |
| **Auditor** (read-only) | Tests controls, traces entries to evidence | Evidence spread across inboxes | An append-only audit trail on every record | MVP |
| **Revenue accountant** | Applies ASC 606 and works the gating queue | Manual trigger checks in CRM | Gating queue and auto-apply policy | v1 |
| **CFO** | Wants close status, risk and the "why" | Gets status late and second-hand | Forecast, insights, Ask AI | v1 |

---

## 4. Goals, non-goals and success metrics

### 4.1 Goals

1. **Headline:** cut the pilot's days-to-close by **≥ 40%** from its measured baseline within 3 closes on the product (D13, D15).
2. Remove manual prep work: AI verification of checklist tasks, AI explanations of flagged variances, and AI-drafted JEs.
3. Keep control: **0** ledger postings without a recorded human approval.
4. Leave an audit trail that the auditor accepts without extra workpapers.

### 4.2 Non-goals

- Replacing the ERP or general ledger. We post *to* the GL; we are not the GL.
- Coexisting with, or migrating from, BlackLine or FloQast (D14).
- Statutory reporting and tax provision.
- AP/AR operations such as invoice capture, payments and collections.
- Posting without any human sign-off. The v1 auto-apply policy (§10.1) still ends in a human batch sign-off.

### 4.3 Success metrics

| Metric | Baseline | Target | Release |
|---|---|---|---|
| **Days-to-close** (calendar days from period end to close sign-off; units to be confirmed in Q5) | Pilot's last 3 closes, measured at onboarding | **≥ 40% reduction** after 3 closes | MVP |
| Share of checklist tasks verified by AI | 0% | ≥ 40% | MVP |
| Share of flagged variances whose AI explanation is accepted without a rewrite | – | ≥ 70% | MVP |
| Draft JEs approved without edits | – | ≥ 80% | MVP |
| Ledger postings without a recorded human approval | – | **0** (hard control) | MVP |
| Post-close adjustments and audit findings | Pilot baseline | Lower than baseline | MVP |
| Missing accruals detected before a reviewer flags them | – | ≥ 90% of accruals booked | v1 |
| Error rate in the auto-apply sample (§10.1) | – | ≤ 2% | v1 |
| Intercompany items matched automatically | – | ≥ 85% | v1 |
| Days from the last entity lock to consolidated sign-off | Pilot baseline | ≤ 1 day | v1 |
| Forecast accuracy (projected vs actual close day) | – | ±1 day by D+2 | v1 |

---

## 5. Core features

| # | Feature | What it does | Release |
|---|---|---|---|
| F1 | **Enterprise Brain: setup and sync** | Connects NetSuite and SAP per entity, maps the chart of accounts and dimensions, syncs ledger data and shows how fresh it is | MVP (ledgers) · v1 (CRM, billing, banking, docs) |
| F2 | **Close status** | Per-entity cards showing % complete, task counts and a status badge, with a roll-up across all entities | MVP (status) · v1 (forecast, burndown, insights) |
| F3 | **Checklist with AI verification** | A phased close template. The AI verifies tasks it can check from connected data and shows its reasoning. Reconciliations are tracked with evidence and sign-off, with no automatic matching (D16) | MVP |
| F4 | **Flux and variance with AI explanations** | Flags lines over the materiality threshold, explains what drives each one with citations, and breaks it down by child account | MVP |
| F5 | **AI context** | Business rules, such as "billing occurs every 45 days", that change how the AI evaluates a line in future periods. They are kept separate from comments and need approval | MVP |
| F6 | **Draft JEs with human-in-the-loop posting** | The AI drafts corrections, reclasses and accruals from flagged lines. A person approves them individually or in a batch, then they post to the ERP | MVP |
| F7 | **Controls and audit trail** | Roles, segregation of duties, approval thresholds, period lock and reopen, an append-only event log, and an AI audit log | MVP |
| F8 | **Accruals and prepaids** | Detects missing accruals from ledger activity and proposes entries | v1 |
| F9 | **Revenue recognition (ASC 606)** | Recognition runs against every contract. A gating queue holds the decisions, and the auto-apply policy covers low-risk items | v1 |
| F10 | **Ask AI copilot** | Read-only questions and answers over close data, with citations | v1 |
| F11 | **Consolidation and intercompany** | Currency translation, IC matching, eliminations and consolidated statements | v1 |

### 5.1 Core concepts

- **Close period**: one entity × one month. It has a target close day and a status: *On track*, *Needs review*, *At risk* or *Set up required*.
- **Enterprise Brain**: the connected-data layer. It is the **only** data the AI reasons over.
- **AI-verified task**: a checklist task the AI checked against connected data. It shows the reasoning, for example "reconciled cut-off timestamps across 14 connected systems and matched them to the close calendar".
- **AI context vs comment**:
  - A **comment** is a note for a colleague.
  - **AI context** is an approved, versioned business rule that changes how the AI evaluates that line from now on.
- **Draft JE**: an AI-prepared entry linked to its source and to the ledger data behind it. Its status moves `Draft → Approved → Posted`, or `Rejected`.

---

## 6. User stories

Each story lists the requirement IDs it covers (§7). The edge cases for these stories are in §8.

### Epic E1: Onboarding and setup

| ID | Story | Acceptance criteria | Reqs | Release |
|---|---|---|---|---|
| US-1 | As an **Admin**, I want to connect each entity's NetSuite or SAP ledger, so that the product works from live data instead of exports | Connection succeeds with credentials scoped to read-only plus draft posting. A first backfill completes. The entity status changes from *Set up required* | EB-1, EB-2, HUB-2 | MVP |
| US-2 | As an **Admin**, I want to map each entity's chart of accounts and dimensions to the product's model, so that flux and JEs line up across both ERPs | Every account with a balance is mapped, or listed as *Unmapped*. The period can't lock while unmapped balances exist | EB-2 | MVP |
| US-3 | As an **Admin**, I want to set materiality thresholds per entity and account class, so that flagged lines match our policy | The default is $25,000 / 10%, whichever trips first. Changes are versioned and logged | FX-2 | MVP |
| US-4 | As an **Admin**, I want to invite users and give them roles per entity, so that segregation of duties is enforced | Roles: Preparer, Reviewer, Approver, Controller, Admin, Auditor (read-only). One user can hold different roles in different entities | NFR-Security | MVP |
| US-5 | As a **Controller**, I want to see when each entity's data last synced, so that I know the AI is working from current numbers | The last sync time appears on the entity card and on every AI output. A failed sync raises a visible alert | EB-4 | MVP |

### Epic E2: Close status and checklist

| ID | Story | Acceptance criteria | Reqs | Release |
|---|---|---|---|---|
| US-6 | As a **Controller**, I want one view of close status for every entity, so that I can see who is behind without chasing people | Each entity card shows % complete, tasks done out of total, and a status badge. A roll-up totals all entities | HUB-1, HUB-5, OV-2 | MVP |
| US-7 | As a **Controller**, I want the close template to roll forward each period with owners, reviewers, due days and dependencies, so that I don't rebuild the checklist every month | Each new period copies the template. Owners and due days (D±n) carry over and can be edited | CL-1 | MVP |
| US-8 | As an **Accountant**, I want the AI to verify the tasks it can check from connected data, and show its reasoning, so that I don't redo mechanical checks | The task shows `COMPLETED BY AI`, the systems it checked and its reasoning. A reviewer can reject it, which re-opens the task | CL-2 | MVP |
| US-9 | As an **Accountant**, I want to edit, add and remove AI-drafted subtasks, so that the task matches how we actually work | Every change is logged with the user and time | CL-3 | MVP |
| US-10 | As an **Accountant**, I want to attach evidence to a reconciliation task and send it for sign-off, so that reconciliations are tracked in one place even though matching stays manual | Evidence attachment is required. The reviewer must be a different user from the preparer. No transaction matching in the MVP (D16) | CL-4, CL-5, CL-8 | MVP |
| US-11 | As a **Reviewer**, I want to comment on a task and see its full history, so that questions and decisions stay with the task | Comments and state changes are append-only | CL-4 | MVP |

### Epic E3: Flux, explanations and AI context

| ID | Story | Acceptance criteria | Reqs | Release |
|---|---|---|---|---|
| US-12 | As an **Accountant**, I want flagged P&L and BS lines, comparing this month with last month, so that I review only what crosses materiality | Lines over either threshold are flagged. The account tree can be expanded | FX-1, FX-2 | MVP |
| US-13 | As an **Accountant**, I want an AI explanation for each flagged line that cites the transactions behind it, so that I start from a draft instead of a blank page | Every claim links to a Brain record. If the data can't support an explanation, the line says "insufficient data" and the AI doesn't guess | FX-3, EB-5 | MVP |
| US-14 | As an **Accountant**, I want to see which child accounts drive a variance, so that I can find the source quickly | Each child account's contribution is shown in amount and % | FX-4 | MVP |
| US-15 | As an **Accountant**, I want to add AI context such as "billing occurs every 45 days" to a line, so that the AI stops flagging an expected pattern as unexplained | The context is saved as *Pending* and a preview explanation is shown. It is kept separate from comments | FX-5 | MVP |
| US-16 | As an **Account owner or Controller**, I want to approve or reject proposed AI context, so that only vetted rules change future explanations | Proposers can't approve their own context. Scope decides who approves (§10.2). Approved context applies to future periods, and every explanation lists the context it used | FX-5, FX-6 | MVP |
| US-17 | As a **Reviewer**, I want to sign off each flagged variance, so that the period can lock | The period can't lock until every flagged line is approved or has an approved exception | FX-7 | MVP |

### Epic E4: Draft JEs and posting

| ID | Story | Acceptance criteria | Reqs | Release |
|---|---|---|---|---|
| US-18 | As an **Accountant**, I want the AI to draft corrections, reclasses and accruals for the flagged lines that need them, so that I don't key entries by hand | Each draft links to its variance line and to the ledger data behind it. The count and total of drafts are calculated from the data, never hard-coded | FX-8, JE-1, JE-2 | MVP |
| US-19 | As an **Accountant**, I want to edit a draft before I submit it, so that I can fix what the AI got wrong | An edited draft records me as its preparer, so I can't approve it myself | JE-4 | MVP |
| US-20 | As an **Approver**, I want to approve entries one by one or in a batch, so that review is quick and still attributable | A batch approval writes one approval event per entry. Entries above the threshold also need a second approver | JE-3, JE-4 | MVP |
| US-21 | As an **Approver**, I want approved entries to post to the right ERP and come back with the ERP document number, so that I know they really posted | Each entry is validated before posting (balanced, accounts open, period open). Its status reads back as `Posted` with the document number. Failures are shown per entry | JE-5, JE-6 | MVP |

### Epic E5: Controls and audit

| ID | Story | Acceptance criteria | Reqs | Release |
|---|---|---|---|---|
| US-22 | As an **Auditor**, I want to trace any posted entry back to its approval, its draft, its AI output and the source data, so that I can test the control | Read-only access. The full chain shows in one view, including the model version and the prompt version | §10 items 2, 4 | MVP |
| US-23 | As a **Controller**, I want to lock a period after sign-off and reopen it only with a reason and an approval, so that closed numbers don't change silently | A reopen needs an approval, and the reason is logged | §10 item 7 | MVP |
| US-24 | As an **Auditor**, I want to export the event log for a period, so that I can work offline | The export covers every state change in the period | NFR-Auditability | MVP |

### Epic E6: Post-MVP (v1) stories

| ID | Story | Reqs | Release |
|---|---|---|---|
| US-25 | As an **Accountant**, I want missing accruals detected from ledger activity, with a suggested amount, so that nobody has to remember them | AC-1 to AC-4 | v1 |
| US-26 | As a **Revenue accountant**, I want a gating queue with trigger evidence and an AI recommendation, so that I can apply or defer recognition with a written justification | RR-1 to RR-7 | v1 |
| US-27 | As an **Approver**, I want to sign off auto-applied recognition items in one batch, and pull any item back to review first, so that low-risk items move fast under policy | RR-7, §10.1 | v1 |
| US-28 | As a **CFO**, I want to ask "why are we behind plan?" and get a cited answer, so that I don't have to wait for a status email | AI-1 to AI-5 | v1 |
| US-29 | As a **Controller**, I want intercompany matched and eliminated automatically, with consolidated statements, so that group close follows entity close within a day | CO-1 to CO-7 | v1 |
| US-30 | As a **Controller**, I want a forecast close day and a burndown chart, so that I can act on slippage early | HUB-3, OV-1 | v1 |

---

## 7. Requirements

### 7.1 Functional requirements

#### Close status (F2)

| ID | Requirement | Release |
|---|---|---|
| HUB-1 | Show a card for every entity and period with % complete, tasks done out of total, and a status badge (On track / Needs review / At risk / Set up required) | MVP |
| HUB-2 | An entity with no connected ledger shows **Set up required**, with a button that leads into setup | MVP |
| HUB-3 | **AI Close Forecast**: the projected close day, its variance to plan, and the top drag factors | v1 |
| HUB-4 | Filter by period, region and status | Later |
| HUB-5 | A *Global Close* roll-up across all entities. It shows task status in the MVP and adds consolidation status in v1 | MVP / v1 |
| OV-1 | Burndown chart with Plan, Actual and AI Projected lines | v1 |
| OV-2 | Close health: % complete, the target date, and complete / open / overdue task counts | MVP |
| OV-3 | Workload by sub-process, complete vs open | v1 |
| OV-4 | AI insights that link to the underlying records | v1 |
| OV-5 | Progress cards per module | v1 |
| OV-6 | Forecast explainability: the drivers behind the projection | Later |

#### Checklist (F3)

| ID | Requirement | Release |
|---|---|---|
| CL-1 | A phased close template (Pre-close, Reconciliations, Accruals, Intercompany, Compliance, Board pack). Each task has an owner, reviewer, due day (D±n) and dependencies, and the template rolls forward each period | MVP |
| CL-2 | Tasks the AI verifies show `COMPLETED BY AI`, plus the systems checked and the reasoning. A reviewer can reject an AI verification | MVP |
| CL-3 | AI-drafted subtasks that users can edit, add, delete and check off, with every change logged | MVP |
| CL-4 | A task drawer with comments, an append-only history and attached evidence | MVP |
| CL-5 | Reviewer sign-off, where the preparer and the reviewer must be different users | MVP |
| CL-6 | Escalation of late and overdue tasks by in-app notification and Slack | v1 |
| CL-7 | Automatic transaction matching for reconciliations (bank, AP, fixed deposits) | Later (D16) |
| CL-8 | Reconciliation tasks require attached evidence and a reviewer sign-off, with no automatic matching | MVP (D16) |

#### Flux and AI context (F4, F5)

| ID | Requirement | Release |
|---|---|---|
| FX-1 | A hierarchical P&L and BS tree comparing the current month with the prior month | MVP |
| FX-1b | Quarter-over-quarter and budget comparisons | v1 |
| FX-2 | Absolute **and** percentage materiality thresholds (default $25,000 / 10%, whichever trips first), configurable per entity and account class | MVP |
| FX-3 | An AI explanation for every flagged line, citing the underlying records. Where the data can't support one, the line says "insufficient data" | MVP |
| FX-4 | Attribution by child account or contract, in amount and % | MVP |
| FX-5 | An AI context tab, kept separate from comments. New context is *Pending* and shown as a preview. Once approved (§10.2), it applies to future periods | MVP |
| FX-6 | Management of AI context: list, edit, retire, see where it was applied, and a review-by date. Every change is logged with the author and the approver | MVP |
| FX-7 | Variance sign-off. The period can lock only when every flagged line is approved or has an approved exception | MVP |
| FX-8 | A **Draft JEs for N flagged lines** action that creates drafts for lines needing a correction, reclass or accrual | MVP |

#### Journal entries (F6)

| ID | Requirement | Release |
|---|---|---|
| JE-1 | AI drafts (Correction, Reclass, Accrual), each linked to its source variance line and to the ledger data behind it. Links to accrual proposals and contracts arrive in v1 | MVP |
| JE-2 | A review view showing the count and total of entries ready to post, both calculated from the data | MVP |
| JE-3 | Approve or reject entries one by one or as a batch. A batch writes one approval event per entry | MVP |
| JE-4 | Segregation of duties: the AI service account can draft but **cannot** approve or post. Whoever last edited a draft can't approve it. Amounts above a configurable threshold need a second approver | MVP |
| JE-5 | Post to the entity's ERP (NetSuite or SAP) and read the status back as `Posted` with the ERP document number | MVP |
| JE-6 | Validation before posting: debits equal credits, accounts exist and are open, the period is open in the ERP, and dimensions are valid | MVP |
| JE-7 | Auto-reversing accruals and supporting attachments | v1 |

#### Enterprise Brain (F1)

| ID | Requirement | Release |
|---|---|---|
| EB-1 | Ledger connectors for **NetSuite and SAP** | MVP |
| EB-1b | CRM (Salesforce, HubSpot) and billing (Stripe) connectors | v1 |
| EB-1c | Communication, documents and banking connectors | Later |
| EB-2 | A per-entity setup wizard: connect, map the chart of accounts, entities and dimensions, then backfill | MVP |
| EB-3 | Reconciliation across systems (ledger ↔ subledger ↔ source) with match rates | v1 |
| EB-4 | Sync health (freshness, failures, last-sync time), shown on every AI output | MVP |
| EB-5 | The AI reasons only over Brain data, and every AI claim cites a Brain record | MVP |

#### v1 modules: accruals (F8), recognition (F9), copilot (F10), consolidation (F11)

| ID | Requirement | Release |
|---|---|---|
| AC-1 | Category spend vs run-rate, accrued liabilities, prepaid assets, and a count of items needing accrual | v1 |
| AC-2 | Detection of missing accruals from ledger activity (recurring vendors with no bill this period, run-rate gaps, open POs) | v1 |
| AC-3 | Each proposal shows the vendor, amount, basis and evidence, and can be approved, edited or dismissed with a reason | v1 |
| AC-4 | An approved proposal creates a draft accrual JE with a reversal date | v1 |
| AC-5 / AC-6 | Balance rollforward and top vendors; prepaid amortization schedules | Later |
| RR-1 | Recognition runs against every contract using the five-step model, producing proposals only | v1 |
| RR-2 / RR-3 | Planned vs recognised by month; KPIs for ARR, deviations and compliance coverage | v1 |
| RR-4 | Gating queue with the columns Needs review, Auto-applied, Started and Deferred. *Auto-applied* only when **every** check in §10.1 passes | v1 |
| RR-5 | Contract drawer with trigger evidence from the source of record | v1 |
| RR-6 | AI recommendation with its rationale. Any override or deferral requires a written justification | v1 |
| RR-7 | A person confirms every result: *Needs review* items one by one, and *Auto-applied* items through a batch sign-off from which any item can be pulled back | v1 |
| RR-8 | Contract modifications and extracting performance obligations from PDFs | Later |
| AI-1 to AI-5 | A global copilot (button or `⌘K`): cited answers, quick prompts, **read-only**, and respects permissions | v1 |
| CO-1 to CO-7 | Entity hierarchy and currencies; translation (ASC 830); IC matching with tolerance (default the greater of $500 or 1%); IC true-ups under the human-approval rules; eliminations in the app's own consolidation layer (D9); consolidated TB and statements with drill-down; consolidation checklist and lock | v1 |
| CO-8 / CO-9 / CO-10 | Consolidated flux; NCI and acquisitions; statutory mapping from Ind AS / IFRS to US GAAP | Later |

### 7.2 Non-functional requirements

| ID | Area | Requirement | Release |
|---|---|---|---|
| NFR-Tenancy | **Multi-tenancy** | Strict isolation of tenant data at the data layer. No AI request ever mixes tenants' data, and AI caches are scoped to one tenant | MVP |
| NFR-Security | **Security** | SSO (SAML/OIDC), role-based access per entity, encryption in transit and at rest, and secrets in a vault. SOC 2 Type II readiness | MVP (SOC 2 audit: v1) |
| NFR-Auditability | **Auditability** | An append-only event log for every state change, exportable. No hard deletes of financial records | MVP |
| NFR-Currency | **Multi-currency** | Functional and reporting currency per entity, with the FX rate source configured per period | MVP |
| NFR-Perf | **Performance** | Dashboard load < 2 s at p95. Flux for 5,000 accounts < 5 s. Copilot first token < 3 s (v1) | MVP |
| NFR-Fresh | **Freshness** | Ledger sync at least hourly during close (configurable) | MVP |
| NFR-Scale | **Scale** | MVP: 3–10 entities and 5–20 users per tenant (D12). v1 targets are set once pilot data is in, not guessed now | MVP |
| NFR-Rel | **Reliability** | 99.9% availability during close windows. Connector retries are idempotent, and a JE is never posted twice | MVP |
| NFR-A11y | **Accessibility** | WCAG 2.2 AA. Every chart has a table fallback | MVP |
| NFR-Residency | **Data residency** | See §11 (D7) | MVP |

---

## 8. Edge cases

**Agreed** behaviour follows from a decision or requirement already in this document. **Proposed** behaviour needs confirmation and is listed in §15 (Q6–Q9).

### 8.1 Data and sync

| # | Scenario | Expected behaviour | Status |
|---|---|---|---|
| EC-1 | The ERP sync fails or goes stale during close | Every AI output shows the last-sync time (EB-4), and an alert is raised. Posting still validates against the ERP at post time (JE-6), so stale data can't cause a bad post | Agreed |
| EC-2 | A new account appears mid-period with no mapping | It shows in an *Unmapped* bucket in flux, and the period can't lock while an unmapped balance exists (US-2) | Agreed |
| EC-3 | The prior period balance is zero, so % change can't be calculated | % is shown as "n/a", and only the absolute threshold applies | Agreed |
| EC-4 | A variance is large in amount but small in % (for example $30,000 at 2%) | It is flagged, because either threshold trips the flag (FX-2) | Agreed |
| EC-5 | The FX rate for the period is missing | Reporting-currency views for that entity are blocked with a clear message. Functional-currency views still work | Agreed |
| EC-6 | Someone posts directly in the ERP after a variance line was signed off, changing its balance | The line is re-flagged as *Changed after approval*, and its sign-off is withdrawn | **Proposed** (Q6) |
| EC-7 | Two entities use different ERPs and dimension models | Both map to the shared internal model (US-2). Unmapped dimensions block posting for that entity only | Agreed |

### 8.2 AI behaviour

| # | Scenario | Expected behaviour | Status |
|---|---|---|---|
| EC-8 | The AI call fails, times out or refuses | No explanation is shown. The line is marked *Needs manual explanation* and can't be approved with a blank explanation | Agreed |
| EC-9 | The data can't support an explanation | The AI says "insufficient data" and doesn't guess (FX-3) | Agreed |
| EC-10 | An explanation would cite a record the user isn't allowed to see | The citation is withheld, and the answer uses only data the user can see (AI-5, NFR-Tenancy) | Agreed |
| EC-11 | Two approved AI context notes on one account conflict | The conflict is flagged when the second note is approved, and the approver must retire or edit one of them | **Proposed** (Q7) |
| EC-12 | AI context reaches its review-by date in the middle of a close | Expiry is checked at the start of each period, so explanations don't change mid-close | **Proposed** (Q7) |
| EC-13 | The AI verified a task, then the upstream data changed | The task re-opens with the reason "source data changed" | **Proposed** (Q6) |

### 8.3 Approvals and posting

| # | Scenario | Expected behaviour | Status |
|---|---|---|---|
| EC-14 | An approver edits an AI draft | They become its preparer and can't approve it. Another approver is needed (JE-4) | Agreed |
| EC-15 | The entity has only one user with the Approver role, so segregation of duties can't be met | Approval is blocked and the Admin is prompted to assign a second approver | Agreed (block) · override policy **open** (Q8) |
| EC-16 | An entry is above the threshold and no second approver is available | It stays pending. There is no override | Agreed |
| EC-17 | Some entries in a batch fail at the ERP | Each entry keeps its own status. Failed entries show the ERP's error, and successful ones are not rolled back (JE-3) | Agreed |
| EC-18 | The ERP accepts the post but the read-back times out | The status is *Posting: unconfirmed* and is resolved by checking against the posting's idempotency key. The entry is never re-posted blindly | Agreed |
| EC-19 | The ERP period is closed when the entry is approved | Validation fails (JE-6). The entry stays *Approved, not posted* with the error until the ERP period reopens | Agreed |
| EC-20 | After a draft was created, AI context explains its variance as expected | The draft is flagged *Source changed*. The preparer withdraws it or confirms it | **Proposed** (Q6) |
| EC-21 | A locked period needs a correction | It needs a reopen with a reason and an approval (US-23). Downstream locks, such as consolidation in v1, also reopen | Agreed |

### 8.4 v1 modules

| # | Scenario | Expected behaviour | Status |
|---|---|---|---|
| EC-22 | The auto-apply aggregate cap is reached partway through a recognition run | The remaining items go to *Needs review* (§10.1) | Agreed |
| EC-23 | A contract is modified in the period | It goes to *Needs review* and is never auto-applied (§10.1) | Agreed |
| EC-24 | An IC counterparty entity hasn't closed yet | The match stays pending, and the consolidated period can't lock (CO-7) | Agreed |
| EC-25 | An IC mismatch is caused only by FX | Within tolerance it auto-matches. Over tolerance, it is flagged with "FX" as the likely cause (CO-3) | Agreed |

---

## 9. MVP scope

### 9.1 MVP definition

**The MVP is the core close loop on both ERPs** (D11):

> Connect the ledgers → run the checklist (with AI verification and tracked reconciliations) → review flux with AI explanations and AI context → draft, approve and post JEs → lock the period, all with a full audit trail.

### 9.2 In scope and out of scope

| In the MVP | After the MVP (v1) | Not planned |
|---|---|---|
| NetSuite and SAP ledger connectors, setup wizard and sync health (F1) | CRM, billing and bank connectors | BlackLine / FloQast import or coexistence |
| Entity status cards and roll-up, and close-health counts (F2, basic) | AI forecast, burndown, insights and workload charts | Statutory and tax reporting |
| Checklist with AI verification, plus reconciliation tracking with evidence and sign-off, no matching (F3) | Automatic transaction matching (Later) | AP/AR operations |
| Flux with thresholds, AI explanations, attribution, sign-off (F4) | Quarter-over-quarter and budget comparisons | |
| AI context with approval (F5) | | |
| Draft JEs, human approval, second approver, posting to both ERPs (F6) | Auto-reversing accruals | |
| Roles, segregation of duties, period lock and reopen, event log, AI audit log, auditor read-only access (F7) | | |
| Multi-tenant SaaS foundations: SSO and tenant isolation | Pricing, packaging and self-serve sign-up (not yet defined) | |
| | Accruals (F8), recognition with auto-apply (F9), Ask AI (F10), consolidation (F11) | |

> **To confirm (Q1):** your MVP decision named the checklist, flux, AI context and JEs. It didn't name the status dashboard or the copilot. This PRD keeps **only** the status view needed to measure days-to-close (HUB-1, HUB-2, HUB-5, OV-2) and moves the forecast, burndown, insights and copilot to v1.

### 9.3 Pilot setup

| | |
|---|---|
| **Design partner** | Not yet chosen (D12) |
| **Size** | 3–10 entities and 5–20 users, with at least one NetSuite entity and one SAP entity |
| **Baseline** | Days-to-close from the partner's last 3 closes, recorded during onboarding (D13) |
| **Pilot length** | 3 consecutive closes on the product |
| **Pre-go-live gates** | The auditor walks through the human-approval and segregation-of-duties controls. Residency is confirmed as acceptable for the pilot (A1) |

### 9.4 MVP exit criteria

1. The design partner runs 3 consecutive closes in-app, on both ERPs.
2. Days-to-close falls by ≥ 40% from the measured baseline. If it doesn't, the shortfall is analysed before starting v1.
3. **0** ledger postings without a recorded human approval.
4. ≥ 70% of AI explanations accepted without a rewrite, and ≥ 80% of draft JEs approved without edits.
5. The auditor accepts the audit trail for the approval controls.

### 9.5 MVP timeline (estimate, not a commitment; D15)

| Phase | Scope | Estimate |
|---|---|---|
| M0: Foundations | Multi-tenant platform, SSO and roles, event log, NetSuite and SAP connectors, setup wizard, Claude model gateway and AI audit log | ≈ 8 wks |
| M1: Close status and checklist | F2 (basic) and F3 | ≈ 4 wks |
| M2: Flux and AI context | F4 and F5 | ≈ 6 wks |
| M3: Draft JEs and posting | F6, posting to both ERPs, period lock | ≈ 6 wks |
| **MVP total** | | **≈ 22–24 wks**, then 3 pilot closes |

The post-MVP v1 phases (accruals, recognition with auto-apply, copilot and forecast, then consolidation) will be sized after the pilot.

---

## 10. AI governance and controls

These rules apply to every module from the MVP onward.

1. **Preparer, never approver.** The AI drafts, detects, explains and recommends. Every action that affects the ledger needs a human approval.
2. **Explainability.** Every AI output records the following in an immutable AI audit log:
   - the model ID and request ID
   - the prompt and template version
   - the input record IDs
   - the output
   - the confidence
   - the reviewing user and their decision
3. **Grounding.** The AI explains only from Brain data. A claim it can't support is labelled "insufficient data".
4. **Change management.** Changes to the model, prompts or thresholds are versioned, approved and must pass the eval suite before release. Past outputs stay reproducible.
5. **Least privilege.** The AI service identity has scoped, read-mostly credentials and **draft-only** rights in the ERP.
6. **AI context governance.** See §10.2.
7. **Period lock.** After sign-off, changing a closed period needs a reopen, with a reason and an approval.

### 10.1 Auto-apply policy (v1, with recognition)

Some low-risk results skip line-by-line review and go straight to an approver's **batch sign-off**. Nothing posts without that sign-off.

The policy is configurable **per entity**. Every change to it is versioned, logged, and needs approval by a Controller and a second approver (CFO or delegate). Each auto-applied item records the policy version it ran under.

**Revenue recognition defaults (D8)**

An item is auto-applied only if **all** of these are true:

| Check | Default | Configurable |
|---|---|---|
| Recognised amount for the contract this period | ≤ **$5,000** (or local equivalent) **and** ≤ **0.5%** of the entity's monthly revenue | Yes |
| AI confidence | ≥ **0.90** | Yes (min 0.80) |
| Trigger evidence | Found in the source of record, with no conflicting evidence | No |
| Contract shape | Standard schedule, no modification this period, no variable consideration | No |
| History | No deviation or override on this contract in the last **3** periods | Yes |
| Aggregate cap | Total auto-applied per entity per period ≤ **$50,000**. After that, items go to *Needs review* | Yes |

**Why these numbers:** $5,000 is one fifth of the $25,000 materiality default, so no single auto-applied item can create a material variance on its own. The $50,000 cap limits the combined exposure to 2× materiality.

**Effect on the demo data:** only *Aarti Industries* ($2,363) would stay auto-applied. *ChargePoint* ($40,417) and *Emirates Rawabi* ($14,583) would move to *Needs review*. That is intended.

**Safeguards:**
- **Sampling:** each period an approver re-checks a random 10% of auto-applied items, with a minimum of 5. An error rate above 2% switches auto-apply off for that entity until the Controller reviews it.
- **Kill switch:** a Controller can turn auto-apply off per entity or per module at any time.

**Other modules (Later, off by default):**
- **Accruals:** reversal of previously approved recurring accruals, ≤ $5,000 per item.
- **Reclass JEs:** reclasses between the entity's own expense accounts, ≤ $2,500 per item.

> **Decision D8:** these are the pilot defaults. The auditor confirms them before go-live (A2), and they are tuned after 2–3 closes using the sample error rates.

### 10.2 AI context ownership (MVP; D4)

| Who | Can do |
|---|---|
| **Any preparer** | **Propose** context. It stays *Pending* (preview only) until approved |
| **Account owner / reviewer** | **Approve** context scoped to one account in one entity that doesn't change the conclusion on a variance above materiality |
| **Controller** | **Approve** context that applies across entities or account groups, changes the conclusion on a material variance, or has no expiry |
| **Policy owner** (Controller by default) | Review all active context every quarter and retire anything stale |

**Rules:**
- **SOD:** whoever proposed a note can't approve it.
- **Expiry:** each note has a review-by date, defaulting to 12 months. A lapsed note goes back to *Pending*. When expiry is checked is open (Q7).
- **Visibility:** every explanation lists the context notes it used, with links.

---

## 11. AI models and hosting

**Decision D3:** use Anthropic Claude models for now. The model layer sits behind an internal interface, so a later provider change touches no product code.

| Workload | Model | Notes | Release |
|---|---|---|---|
| Variance explanations, JE drafting, AI task verification | **Claude Opus 5.5** (`claude-opus-5-5`) | Adaptive thinking with effort set per route. **Structured outputs** for drafts. **Citations** to Brain records | MVP |
| Recognition recommendations, accrual detection, IC mismatch reasoning | Claude Opus 5.5 | Same as above | v1 |
| Bulk overnight runs | Claude Opus 5.5 via the **Message Batches API** | Batches cost about 50% less, and these runs aren't latency-sensitive | v1 |
| Ask AI copilot | Claude Opus 5.5 (streaming) | Claude Sonnet 5.5 (`claude-sonnet-5-5`) can be evaluated later for latency, and adopted only if it holds quality on the eval set | v1 |

**Engineering requirements:**
- **Prompt caching**, scoped to one tenant, for stable context such as the chart of accounts and approved AI context.
- **Refusal handling**: check `stop_reason` on every call, and enable server-side fallbacks.
- **Change control**: pin model IDs, and run the eval suite before any model change.

**Data residency (D7):** the pilot uses Anthropic's API with **global processing plus data minimisation**.
- Only the fields each task needs are sent. No personal data; internal IDs are used where possible.
- The processing region is logged on every call.
- Anthropic's API has **no India or UAE region**. In-region hosting would need Amazon Bedrock, Google Cloud Vertex AI or Microsoft Foundry, and whether Claude is offered in those regions there is **unverified**. Confirming it is action A1, due before production.

---

## 12. Current prototype vs this PRD

| Area | Today (prototype) | Gap to close |
|---|---|---|
| Frontend | Vanilla JS single-page app, 8 views and 3 drawers ([public/](public/)) | Split into components: [app.js](public/js/app.js) is one 1,170-line file. Add routing, state management and tests |
| Backend | Python `http.server` with about 15 REST endpoints ([server.py](server.py)) | Production framework, auth, validation, and a job queue for syncs and AI runs |
| Data | SQLite seeded by [init_db.py](init_db.py), 11 tables | Postgres, multi-tenant, event log, period locking |
| AI | Explanations, insights and copilot answers are **hard-coded or templated** | Real Claude calls with grounding, citations, evals and the AI audit log |
| Integrations | Source cards are static | NetSuite and SAP connectors (MVP), then the others |
| Controls | No users or roles; the author is hard-coded; batch approve just flips a status | Roles, segregation of duties, thresholds, ERP posting with read-back |
| Data consistency | The demo shows **37** flagged lines but **24** drafts, and the approve button says **$751,000** while the total is **$701,000** ([index.html:740](public/index.html#L740)) | Calculate every count and total from the data |

---

## 13. Release plan

| Release | Scope | Exit criteria |
|---|---|---|
| **MVP** (≈ 22–24 wks + 3 pilot closes) | §9: phases M0–M3 | §9.4 |
| **v1a: Detect more** | Accruals (F8), recognition with auto-apply (F9), CRM and billing connectors | Auditor signs off the auto-apply control (A2) |
| **v1b: Visibility** | Forecast, burndown, insights, Ask AI (F10), Slack escalation | Forecast within ±1 day by D+2 |
| **v1c: Consolidate** | Translation, IC matching, eliminations, consolidated statements (F11) | Pilot group consolidated in-app for one close |
| **Later** | Reconciliation matching, NCI, statutory mapping, auto-apply for accruals and reclasses | – |

The v1 order and sizing are to be confirmed after the MVP pilot.

---

## 14. Glossary

| Term | Meaning |
|---|---|
| **D+n** | Day n after period end. Calendar vs business days is to be confirmed (Q5) |
| **Flux** | Period-over-period change in an account balance |
| **HITL** | Human in the loop: a person approves before anything reaches the ledger |
| **SOD** | Segregation of duties: preparer and approver must be different people |
| **IC** | Intercompany |
| **CTA** | Cumulative translation adjustment |

---

## 15. Decisions, risks and open questions

### 15.1 Decisions

| # | Topic | Decision |
|---|---|---|
| D1 | Pilot ERPs | **Both NetSuite and SAP** |
| D2 | AI auto-apply | **Yes, under a configurable policy** (§10.1). Applies to recognition in v1 |
| D3 | LLM provider | **Anthropic Claude for now**, behind a swappable interface (§11) |
| D4 | AI context approval | **Tiered by scope**, and proposers never approve their own context (§10.2) |
| D5 | Auto-applied vs human confirmation | **Pre-approved by policy, then a human batch sign-off** (RR-7) |
| D6 | Consolidation | **In v1** (after the MVP) |
| D7 | Pilot data residency | **Global processing plus data minimisation**. In-region options to be confirmed before production |
| D8 | Auto-apply defaults | **The §10.1 defaults**, confirmed by the auditor and tuned after 2–3 closes |
| D9 | Where consolidation lives | **The app's own consolidation layer** |
| D10 | Group reporting | **US GAAP**, with Ind AS and UAE IFRS as entity-level statutory books |
| D11 | MVP boundary | **The core close loop**: checklist, flux with AI explanations, AI context, draft JEs with human-approved posting, on both ERPs |
| D12 | Customer and pilot | **SaaS for multi-entity mid-market finance teams**, with a design-partner pilot. Partner not yet chosen; sized for 3–10 entities and 5–20 users |
| D13 | Baseline | **Measured from the partner's last 3 closes** during onboarding |
| D14 | Existing tools | **Replaces spreadsheets and email.** No BlackLine or FloQast coexistence or migration |
| D15 | Timeline | **Driven by the plan.** Phase sizes are estimates, not commitments |
| D16 | Reconciliations in the MVP | **Tracked only**: evidence and sign-off, no automatic matching |
| — | Top problem | **Close takes too long.** Days-to-close is the headline metric |

### 15.2 Open questions (please confirm)

| # | Question | Proposed answer |
|---|---|---|
| Q1 | Do the status view and copilot belong in the MVP? | MVP keeps only the status needed to measure days-to-close. The forecast, burndown, insights and copilot move to v1 (§9.2) |
| Q2 | Which NetSuite and SAP editions must be supported, for example NetSuite OneWorld, and SAP S/4HANA or ECC? | Unknown. This sets the connector scope, so it needs answering before phase M0 |
| Q3 | What does the ideal design partner look like, and how will we find one? | Unknown |
| Q4 | Pricing and packaging | Out of scope for this PRD. Needs a separate decision |
| Q5 | Is days-to-close counted in calendar or business days? | Calendar days, matching APQC, so benchmarks compare like for like |
| Q6 | What happens when ledger data changes after something was approved (EC-6, EC-13, EC-20)? | Re-flag it and withdraw the approval or completion, as described in §8 |
| Q7 | How should conflicting AI context and expiry timing work (EC-11, EC-12)? | Flag the conflict at approval time, and check expiry at the start of each period |
| Q8 | Can a Controller override segregation of duties in a team with a single approver (EC-15)? | No override in the MVP; block approval and ask the Admin to assign a second approver. Revisit with the auditor |

### 15.3 Risks

| Risk | Mitigation |
|---|---|
| **No design partner yet**, so MVP scope may not fit their reality | Validate §9 with the partner before M1, and keep each phase in a state that could ship |
| **Two ERPs from day one** strain the timeline | A shared internal ledger model with per-ERP adapters, one owner per connector, and M0 sized at about 8 weeks. Q2 must be answered early |
| **Plausible but wrong AI explanations** get approved | Citations, an "insufficient data" fallback, confidence scores, and sampled checks of accepted explanations |
| **AI context drift** hides real issues | Approval tiers, review-by dates, and every explanation shows the context it used |
| **ERP write access** | Scoped service accounts; the AI can only draft; posting happens only after human approval |
| **Residency** blocks India or UAE entities in production | Action A1 before production; data minimisation during the pilot |
| **Consolidation in v1** adds a large accounting engine | Limited to translation, IC matching and eliminations; NCI and acquisitions come later |

### 15.4 Follow-up actions

| # | Action | Owner | Due |
|---|---|---|---|
| A1 | Confirm whether Claude is offered in Indian and UAE regions on Bedrock, Vertex AI or Foundry, and get legal's view of residency obligations | Eng lead + Legal | Before production |
| A2 | Get the auditor's sign-off on the §10.1 defaults and record it in the SOX narrative | Controller | Before v1a goes live |
| A3 | Confirm the statutory mapping needs (CO-10) | Controller | Before planning Later items |
| A4 | Choose the design partner and record their 3-close baseline | Product | Before M1 |

---

## 16. References

- Demo transcript: `WhatsApp Video 2026-10-06 at 20.06.18.txt` (CFO Suite walkthrough)
- Prototype docs: [README.md](README.md), [TESTING_GUIDE.md](TESTING_GUIDE.md)
- Close benchmarks: [CFO.com: Cycle time for monthly close (APQC)](https://www.cfo.com/news/metric-of-the-month-cycle-time-for-monthly-close/), [Numeric: Month-end close benchmarks](https://www.numeric.io/blog/how-long-does-month-end-close-take)
- Flux thresholds: [Ramp: What threshold triggers a flux explanation?](https://ramp.com/answers/flux-variance-analysis/flux-explanation-threshold), [FloQast: Variance analysis red flags](https://www.floqast.com/blog/variance-analysis-red-flags-what-auditors-notice-first)
- ASC 606: [Stripe: ASC 606 how-to guide](https://stripe.com/en-nl/resources/more/asc-606-how-to-guide). The authoritative source is FASB ASC Topic 606
- AI and SOX controls: [MLflow: SOX compliance and AI](https://mlflow.org/articles/sox-compliance-ai), [Rillet: AI with controls](https://www.rillet.com/blog/ai-with-control), [Uniqus: Controlling the agentic finance function (PDF)](https://uniqus.com/wp-content/uploads/2026/09/Controlling-the-Agentic-Finance-Function.pdf). For binding requirements, use PCAOB AS 2201 and the external auditor
- Market: [Ledge: BlackLine vs Numeric vs Ledge](https://www.ledge.co/content/blackline-vs-numeric-vs-ledge-what-100-finance-leaders-say), [Toolradar: Best month-end close software](https://toolradar.com/guides/best-month-end-close-software)

> Much of the market research comes from vendor-authored sources. Treat performance claims as directional.
