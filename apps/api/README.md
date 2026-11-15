# Continuous Close Hub: API and worker

FastAPI + Python 3.12, PostgreSQL 16 with row-level security, and a Postgres-backed job queue. This follows [TECH-STACK.md](../../TECH-STACK.md), [ARCHITECTURE.md](../../ARCHITECTURE.md) and [DATABASE.md](../../DATABASE.md). The API implements the same contract the web app was built against (`apps/web/src/shared/api/types.ts`).

## Run it locally

```bash
cd apps/api
cp .env.example .env              # first time only
docker compose up -d db           # Postgres 16 on :5433, with dev login roles
uv sync
uv run alembic upgrade head       # 0001 = database/schema.sql, 0002 = v1 tables + job queue, 0003 = draft line edits
uv run python -m app.seed         # fictional Northwind Holdings demo data (--reset to start over)

uv run uvicorn app.main:app --reload --port 8001     # API (docs at http://localhost:8001/api/docs)
uv run python -m app.jobs.worker                      # worker, in a second terminal
```

Then run the web app against it:

```bash
cd apps/web
VITE_USE_MOCK_API=false npm run dev   # Vite proxies /api to :8001, so cookies stay same-origin
```

Or run everything in containers: `docker compose --profile app up -d --build` (then run migrations and the seed against :5433 as above).

## Tests

```bash
uv run pytest        # needs the `db` container; creates and drops its own `cch_test` database
uv run ruff check app tests
```

The tests run against a real Postgres, because row-level security, grants and triggers only behave correctly there. They cover:
- sessions, CSRF and provisioning
- tenant isolation
- segregation of duties, both in the API and in the database triggers
- balancing, idempotency keys, idempotent posting and period lock
- AI context approval tiers
- the audit hash chain and the AI gateway's citation checks

## How it fits together

| Piece | Where |
|---|---|
| One transaction per request, tenant set with `SET LOCAL` | `app/core/db.py`, `app/core/auth.py::session` |
| Server-side sessions (SHA-256 of the cookie), CSRF double-submit, idempotency keys | `app/core/auth.py`, `app/core/middleware.py` |
| Role → permission matrix; SOD checks also enforced by DB triggers | `app/core/permissions.py`, `database/schema.sql` |
| RFC 9457 errors (DB constraint violations mapped automatically) | `app/core/errors.py` |
| Hash-chained audit events | `app/core/audit.py` + trigger `audit.chain_event` |
| AI gateway: minimised payload, structured output, citation check, AI audit log | `app/ai/gateway.py` |
| Job queue: jobs are enqueued in the same transaction as the change that needs them; the worker claims with `SKIP LOCKED` | `app/jobs/` |
| ERP connectors behind one interface | `app/connectors/base.py` |
| Business rules (variances, lock gates, forecast, journals, auto-apply) | `app/services/` |
| HTTP routes | `app/routers/` |

**Database roles:**
- **`cch_api`** (member of `app_api`) and **`cch_worker`** (member of `app_worker`) are the runtime logins.
- **The worker:** only it can record ERP posting attempts and write ledger data.
- **Sign-in functions:** run as `app_auth`.
- **The job claim:** runs as `app_jobs`. Both bypass row-level security for one narrow, known query each.

## What needs credentials before production

| Area | Today | To turn on |
|---|---|---|
| **SSO** | A dev identity provider (`CCH_DEV_IDP=true`) lists the tenant's users. | Set `CCH_WORKOS_CLIENT_ID` and `CCH_WORKOS_API_KEY`. `/auth/login` then redirects to WorkOS, and `/auth/callback` exchanges the code. The web app needs a `/auth/callback` route for the redirect (not built yet; the dev IdP page is used locally). |
| **AI** | Offline mode without a key. Outputs are deterministic and labelled `offline-rules`; seeded outputs are labelled `demo-seed`. | Set `ANTHROPIC_API_KEY`. The gateway uses `claude-opus-5-5` with structured outputs, server-side fallbacks and prompt caching. Set `CCH_AI_INFERENCE_GEO=us` for US-only processing (PRD D7). |
| **ERP** | Seeded connections are `simulated`. Posting returns deterministic document numbers, keyed by the idempotency key. | NetSuite (SuiteTalk REST + SuiteQL) and SAP adapters need sandbox credentials in Secrets Manager. SAP also needs the S/4HANA vs ECC answer (PRD Q2). Until then, live connections refuse with a clear message. |
| **Evidence files** | Upload records metadata and marks the file scanned. | S3 pre-signed URLs and malware scanning (ARCHITECTURE S-10). |

## Known simplifications

- **Demo calendar:** "today" is fixed at **D+4 of Aug 2026** (`CCH_DEMO_CLOSE_DAY`, `CCH_DEMO_PERIOD`), so the demo is stable. A real deployment derives the close day from the clock and each entity's period end.
- **Variance IDs:** the API addresses variances by **account ID** within the open period, which matches the web contract. Multi-period views will add the period to those URLs.
- **Response shapes:** responses are built as JSON dicts that match `types.ts`, and request bodies are validated with Pydantic. Typed response models are next, so the OpenAPI spec can generate the web client (TECH-STACK §7).
