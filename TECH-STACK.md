# Tech Stack: Continuous Close Hub

| | |
|---|---|
| **Status** | Proposed v1.0, not yet implemented |
| **Date** | 15 Nov 2026 |
| **Based on** | [PRD.md](PRD.md) v2.0 |
| **Priorities** | Simplicity, security and scalability, in that order for the MVP |

The product owner suggested React, Python with FastAPI, and PostgreSQL. All three are confirmed here. This document fills in the rest of the stack and explains each choice against specific PRD requirements.

---

## 1. Requirements that drive the stack

| PRD requirement | What it demands from the stack |
|---|---|
| Multi-tenant SaaS (NFR-Tenancy) | Customer data isolation that holds even when application code has a bug |
| Financial correctness | Exact decimal arithmetic, an append-only event log, no hard deletes, and segregation of duties (SOD) enforced close to the data |
| Posting to NetSuite and SAP (JE-5, NFR-Rel, EC-18) | Reliable background jobs with retries, and posting that can never duplicate an entry |
| AI at the core (§10, §11) | Claude with structured outputs and citations, an AI audit log, and an eval suite that gates every model or prompt change |
| Enterprise login (NFR-Security) | SSO per customer (SAML/OIDC), roles per entity, SOC 2 readiness |
| Accessibility (NFR-A11y) | WCAG 2.2 AA, with a table fallback for every chart |
| Performance (NFR-Perf) | Flux for 5,000 accounts in under 5 seconds; dashboard under 2 seconds at p95 |
| MVP scale (NFR-Scale) | 3–10 entities and 5–20 users per customer, so simplicity matters more than extreme scale |
| Data residency (D7, A1) | A path to in-region hosting for India and UAE entities later |

---

## 2. Summary

| Layer | Recommendation |
|---|---|
| **Frontend** | React 18 + TypeScript (Vite), TanStack Query and Table, shadcn/ui with Tailwind, React Hook Form + Zod, Recharts |
| **Backend** | Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2.0 + Alembic, a background job queue (see D-2), Anthropic Python SDK |
| **Database** | PostgreSQL 16 (Amazon RDS) with row-level security; Amazon S3 for evidence files |
| **Authentication** | A B2B identity provider for SSO (see D-3); roles and SOD in our own code and database |
| **APIs** | REST + OpenAPI with a generated TypeScript client, idempotency keys, Server-Sent Events for streaming |
| **Testing** | pytest + Testcontainers + Hypothesis, AI eval suite, Vitest, Playwright + axe-core, dependency and image scanning |
| **Deployment** | AWS: ECS Fargate, RDS, S3 + CloudFront, Secrets Manager + KMS, Terraform, GitHub Actions, OpenTelemetry + Sentry |

---

## 3. Frontend

| Piece | Choice | Why |
|---|---|---|
| Framework | **React 18 + TypeScript**, built with **Vite** as a static single-page app | It's a logged-in tool, so it gains nothing from server-side rendering or search indexing. A static bundle is the simplest thing to host and secure. TypeScript catches type mistakes, such as amounts or IDs, at build time |
| Server data | **TanStack Query** | Handles caching, refetching and stale data, which supports the PRD's last-sync and freshness rules (EB-4) |
| Routing | **TanStack Router** or React Router | Typed routes for the 9 module screens |
| Tables | **TanStack Table** with row virtualisation | The flux screen is an expandable account tree that must handle 5,000 accounts in under 5 seconds |
| Components | **shadcn/ui** (built on Radix) + **Tailwind CSS** | Radix components are accessible by default, which covers most of the WCAG 2.2 AA requirement. The component code lives in our repo, so there's no locked-in UI library |
| Forms and validation | **React Hook Form** + **Zod** | Typed validation for JE edits, thresholds and AI context forms |
| Charts | **Recharts** | Enough for the burndown and the planned-vs-recognised charts. Each chart also gets a data-table fallback |

**Considered and rejected:**
- **Next.js:** adds a Node server and server-side rendering, which a logged-in app doesn't need.
- **A heavy enterprise UI kit** (MUI, AntD): bigger bundles and harder to theme. shadcn/ui gives us more control with less code.

---

## 4. Backend

| Piece | Choice | Why |
|---|---|---|
| Language | **Python 3.12**, pinned in containers | The prototype and the team are already in Python, and it has the strongest AI SDK support. Local machines may run newer Python (3.15 on one dev laptop), which some libraries don't support yet, so production pins 3.12 |
| API framework | **FastAPI** + **Pydantic v2** | Typed, validated request and response models, with an OpenAPI spec generated automatically. Its async support suits streaming Claude calls and slow ERP calls |
| Database access | **SQLAlchemy 2.0** + **Alembic** | A mature, explicit ORM with versioned schema migrations, which supports the PRD's change-management control (§10, item 4) |
| Money | Python **`Decimal`** everywhere, never `float` | Debits must equal credits exactly (JE-6) |
| AI | **Anthropic Python SDK** | The official SDK. Pydantic models map directly onto Claude structured outputs, so AI drafts arrive as validated objects |
| Background jobs | See **decision D-2** | ERP syncs, AI batch runs and posting need retries and scheduling |
| Dependencies | **uv** | Fast, with reproducible lockfiles. It's already installed on the team's machines |
| Code quality | **ruff** (lint and format) + **mypy** (type checking) | Catches errors early, with one formatter for everyone |

### 4.1 Structure (proposed)

The backend is a **modular monolith**: one deployable app, with clear internal modules. It is not split into microservices.

| Module | Responsibility |
|---|---|
| `tenancy` | Customers, entities, users, roles |
| `brain` | Connectors and sync, the shared ledger model, data freshness |
| `close` | Periods, checklist, tasks, reconciliations, lock and reopen |
| `flux` | Thresholds, variances, AI explanations, AI context |
| `journals` | Drafts, approvals, SOD, posting |
| `ai` | The model gateway, prompts, evals, AI audit log |
| `audit` | The append-only event log and exports |

Each ERP has its own adapter behind one shared ledger interface:
- **NetSuite:** SuiteTalk REST and SuiteQL.
- **SAP:** OData APIs. The exact SAP interface depends on the edition, S/4HANA or ECC, which is PRD question Q2.

**Why a monolith:** at MVP scale, microservices would add network calls, separate deployments and distributed transactions without solving any problem we have. The modules can be split out later if one of them needs to scale on its own.

### 4.2 Considered and rejected

- **Django:** it includes admin screens and auth, but FastAPI fits an API-first app with streaming and typed Pydantic models better.
- **Node.js / NestJS:** a viable option, but it would mean dropping the team's existing Python and the most mature AI tooling.

---

## 5. Database

**PostgreSQL 16**, managed on Amazon RDS.

| PRD need | How it is met |
|---|---|
| Tenant isolation | **Row-level security (RLS)**: the API sets the tenant ID on each database session, and Postgres filters every query by it. A missing `WHERE` clause in code still can't leak another customer's data |
| Append-only audit log | A dedicated event table. The application's database user is granted **INSERT and SELECT only**, with no UPDATE or DELETE, so this is enforced by the database rather than by code |
| No hard deletes | Financial tables use status columns (for example `Rejected`, `Retired`) instead of deletes, enforced by grants |
| SOD and accounting rules | **CHECK constraints** and triggers, such as "approver ≠ preparer" and "draft lines balance" |
| Exact amounts | **NUMERIC** columns for every amount, plus currency codes |
| AI outputs and ERP payloads | **JSONB** for prompts, outputs and citations, stored alongside relational data |
| Evidence files (CL-4) | **Amazon S3** with encryption and per-tenant prefixes. Postgres stores only references |
| Job queue | The same Postgres instance if decision D-2 chooses a Postgres-backed queue |

**Not needed:** a vector database. The AI cites Brain records directly; there is no similarity search in the PRD.

**Scaling path:** read replicas for reporting, then table partitioning by tenant or period for the event log and GL lines. None of this is needed at MVP size.

---

## 6. Authentication and authorization

| Piece | Choice | Why |
|---|---|---|
| Sign-in and SSO | A managed **B2B identity provider**: see **decision D-3** | Each customer connects their own identity provider (SAML or OIDC), with directory provisioning (SCIM) and multi-factor login, without custom work from us. We never store passwords |
| Authorization | **Our own code and database** | Roles per entity (Preparer, Reviewer, Approver, Controller, Admin, Auditor), "whoever edited a draft can't approve it" and second approvers above a threshold are accounting rules. They're enforced in the API **and** backed by database constraints |
| Sessions | **HttpOnly, Secure, SameSite cookies** with short-lived tokens | Tokens are never stored where browser scripts can read them |
| AI and connector identities | **Separate service identities** with least privilege | The AI service can only **draft**. It can never approve or post (JE-4, §10 item 5) |
| ERP credentials | Encrypted per tenant with **AWS KMS** (envelope encryption), stored in **Secrets Manager** | Credentials that can post to a ledger are the most sensitive secrets in the system |

**Considered and rejected:** self-hosting Keycloak. It works, but running our own identity server adds operations work and security exposure that a managed provider removes.

---

## 7. APIs

| Area | Choice | Why |
|---|---|---|
| Style | **REST + OpenAPI**, generated by FastAPI | Simple, cacheable, and easy for auditors and partners to understand |
| Client | A **typed TypeScript client generated** from the OpenAPI spec (for example orval or openapi-typescript) | Frontend and backend types can never drift apart |
| Versioning | `/api/v1` path prefix | Lets the API change later without breaking existing clients |
| Safety | **Idempotency keys** on every request that changes state, and required on approval and posting | Retries can never post a journal entry twice (EC-18) |
| Streaming | **Server-Sent Events (SSE)** for copilot answers and long-running job progress | Simpler than WebSockets, since the stream only flows from server to client |
| Inbound | ERP webhooks where NetSuite or SAP offer them; scheduled polling elsewhere | Meets the hourly freshness target (NFR-Fresh) |
| Errors | One error format across the API (RFC 9457 problem details) | Consistent handling in the UI and in tests |
| Limits | Rate limits per tenant and per user | Protects the system from one noisy customer |

**Considered and rejected:** GraphQL. It's flexible, but it adds schema and resolver complexity and makes field-level permissions harder. REST with generated types gives us the safety we need more simply.

---

## 8. Testing

| Layer | Tools | What it proves |
|---|---|---|
| Backend unit and integration | **pytest** + **Testcontainers** (a real Postgres per test run) | RLS, grants and constraints only behave correctly against a real database |
| Accounting rules | **Hypothesis** (property-based testing) | Rules like "every JE balances", "eliminations net to zero" and "translation ties out" hold for any input, not just hand-picked examples |
| ERP connectors | Recorded responses in CI, plus scheduled **contract tests** against NetSuite and SAP sandboxes | Catches ERP API changes without needing live ERPs on every build |
| AI | An **eval suite**: a golden set of variances, explanations and drafts, scored automatically | Required by PRD §10 item 4. Every model or prompt change must pass before release |
| Frontend | **Vitest** + **React Testing Library** | Component behaviour |
| End to end | **Playwright** + **axe-core** | The core flow (flux → draft → approve → post → lock) works end to end, and every screen passes accessibility checks |
| Security | ruff security rules / bandit, **pip-audit**, **npm audit**, **Dependabot**, **Trivy** image scans | Code and supply-chain security, which a SOC 2 review will ask about |

**CI gate order:** lint and type-check → unit tests → integration tests → AI evals → end-to-end tests → security scans → deploy.

---

## 9. Deployment and operations

| Piece | Choice | Why |
|---|---|---|
| Cloud | **AWS** | It offers Amazon Bedrock, one candidate route for India and UAE residency (PRD action A1), plus Mumbai and UAE regions. Bedrock's Claude availability in those regions is **not yet verified** |
| Compute | **ECS Fargate**: an API service and a worker service | Managed containers with no Kubernetes cluster to run, which is the right complexity for the MVP |
| Database | **RDS PostgreSQL**, Multi-AZ, encrypted at rest, point-in-time recovery | Managed backups and failover support the 99.9% availability target |
| Frontend hosting | **S3 + CloudFront** | A static app on a CDN, with nothing extra to operate |
| Secrets and keys | **Secrets Manager + KMS** | Central, audited, rotatable secrets |
| Infrastructure as code | **Terraform** | Repeatable environments, so the same stack can be stood up in another region for residency |
| CI/CD | **GitHub Actions** | The repo is already on GitHub. It runs the full gate in §8 before deploying |
| Environments | `dev` → `staging` (with ERP sandboxes) → `prod` | Production changes are tested against sandboxes first |
| Monitoring | **OpenTelemetry** traces + **Sentry** errors + CloudWatch | Traces across the API, workers, ERP calls and Claude calls |
| Containers | **Docker**, with the same image in every environment | What gets tested is what gets deployed |

**Considered and rejected:**
- **Kubernetes (EKS):** too much operations work for the MVP. Revisit only if the number of services grows significantly.
- **Serverless functions for the API:** cold starts and long ERP calls fit poorly, and long-running syncs need workers anyway.

**Region plan:** the pilot runs in a single region with global Claude processing (D7). Additional regions get the same Terraform stack once action A1 is resolved.

---

## 10. Security summary

How the stack meets the PRD's controls:

| Control | Where it is enforced |
|---|---|
| Customer isolation | Postgres RLS + tenant-scoped caches and S3 prefixes + no cross-tenant AI prompts |
| SOD (preparer ≠ approver, AI can't approve) | API authorization **and** database constraints **and** separate service identities |
| Append-only audit trail | Database grants (insert-only), not application code |
| No duplicate postings | Idempotency keys + posting status check before any retry |
| Secret protection | KMS envelope encryption per tenant + Secrets Manager |
| Change control (models, prompts, thresholds) | Versioned in Git and the database; gated by the eval suite in CI |
| Supply chain | Locked dependencies (uv, npm), automated audits, image scanning |

---

## 11. Decisions needed

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D-1 | Confirm the core stack | React + FastAPI + PostgreSQL | **Confirmed** (product owner's suggestion) |
| D-2 | Background job queue | **(a)** A Postgres-backed queue (for example Procrastinate): no extra datastore, transactional with app data. **(b)** Celery + Redis: the most widely used option, but one more service to run. **(c)** Temporal: the strongest workflow guarantees, but the heaviest to operate | **(a) for the MVP.** Move to (c) if connector and posting workflows get complicated |
| D-3 | Identity provider | **WorkOS**: built for B2B SSO and SCIM. **Auth0**: broad features, often costs more at enterprise tiers | **WorkOS**, subject to commercial terms |
| D-4 | SAP integration method | OData (S/4HANA) or RFC/BAPI (ECC) | Depends on PRD question **Q2**. Answer before phase M0 |

---

## 12. Out of scope for this document

- Data model and schema design
- Detailed API endpoint design
- Cost estimates and pricing
- Prompt design and eval set contents

Each will be covered in its own design document before or during phase M0.
