"""Columns the API contract needs, v1 module tables (accruals, recognition,
consolidation) and the Postgres-backed job queue (TECH-STACK D-2).

Revision ID: 0002
Revises: 0001
"""

from alembic import op

revision = "0002"
down_revision = "0001"

SQL = r"""
-- ---------------------------------------------------------------- contract columns
ALTER TABLE tenancy.entities
  ADD COLUMN region TEXT NOT NULL DEFAULT '',
  ADD COLUMN ownership_pct NUMERIC(5,2) NOT NULL DEFAULT 100 CHECK (ownership_pct > 0 AND ownership_pct <= 100),
  ADD COLUMN parent_id UUID,
  ADD FOREIGN KEY (tenant_id, parent_id) REFERENCES tenancy.entities (tenant_id, id);
ALTER TABLE tenancy.users ADD COLUMN title TEXT NOT NULL DEFAULT '';

ALTER TABLE brain.accounts ADD COLUMN is_group BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE brain.connections
  ADD COLUMN mode TEXT NOT NULL DEFAULT 'live' CHECK (mode IN ('live', 'simulated'));

ALTER TABLE close.tasks
  ADD COLUMN description TEXT NOT NULL DEFAULT '',
  ADD COLUMN completed_day SMALLINT;

-- AI suggestion of the entry a flagged line needs: {"type", "amount", "offsetCode"}
ALTER TABLE flux.variances ADD COLUMN needs_entry JSONB;

ALTER TABLE flux.context_notes
  ADD COLUMN changes_material_conclusion BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN preview_explanation TEXT,
  ADD COLUMN decision_reason TEXT,
  ADD COLUMN retired_by UUID,
  ADD FOREIGN KEY (tenant_id, retired_by) REFERENCES tenancy.users (tenant_id, id);

ALTER TABLE journals.je_drafts
  ADD COLUMN number TEXT NOT NULL,
  ADD COLUMN source_label TEXT,
  ADD COLUMN source_ref_id UUID,
  DROP CONSTRAINT je_drafts_source_type_check,
  ADD CONSTRAINT je_drafts_source_type_check CHECK (source_type IN ('variance', 'manual', 'accrual_proposal', 'contract', 'ic_true_up'));
CREATE UNIQUE INDEX je_drafts_number_uq ON journals.je_drafts (tenant_id, number);

ALTER TABLE ai.ai_outputs
  DROP CONSTRAINT ai_outputs_kind_check,
  ADD CONSTRAINT ai_outputs_kind_check CHECK (kind IN
    ('variance_explanation', 'context_preview', 'je_draft', 'task_verification', 'subtask_draft',
     'copilot_answer', 'accrual_detection', 'recognition_recommendation', 'ic_mismatch'));

-- Audit events carry a readable summary and the entity, both inside the hash.
ALTER TABLE audit.events
  ADD COLUMN entity_id UUID,
  ADD COLUMN summary TEXT NOT NULL DEFAULT '';
CREATE INDEX events_entity_idx ON audit.events (tenant_id, entity_id, id);

CREATE OR REPLACE FUNCTION audit.chain_event() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text, 0));
  SELECT e.hash INTO NEW.prev_hash
    FROM audit.events e
   WHERE e.tenant_id = NEW.tenant_id
   ORDER BY e.id DESC
   LIMIT 1;
  NEW.hash := digest(
    coalesce(NEW.prev_hash, '\x'::bytea) ||
    convert_to(concat_ws('|',
      NEW.tenant_id, NEW.occurred_at, NEW.actor_type, NEW.actor_id, NEW.action,
      NEW.subject_type, NEW.subject_id, NEW.entity_id, NEW.summary,
      NEW.before::text, NEW.after::text, NEW.request_id),
      'UTF8'),
    'sha256');
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------- v1: accruals
CREATE SCHEMA accruals;
CREATE TABLE accruals.category_spend (
  tenant_id  UUID NOT NULL,
  entity_id  UUID NOT NULL,
  period     core.period_month NOT NULL,
  category   TEXT NOT NULL,
  actual     core.money_amount NOT NULL,
  run_rate   core.money_amount NOT NULL,
  PRIMARY KEY (tenant_id, entity_id, period, category),
  FOREIGN KEY (tenant_id, entity_id) REFERENCES tenancy.entities (tenant_id, id)
);
CREATE TABLE accruals.proposals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  entity_id       UUID NOT NULL,
  period          core.period_month NOT NULL,
  vendor          TEXT NOT NULL,
  category        TEXT NOT NULL,
  basis           TEXT NOT NULL CHECK (basis IN ('run_rate', 'contract', 'open_po')),
  amount          core.money_amount NOT NULL CHECK (amount > 0),
  currency        core.currency_code NOT NULL,
  evidence        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'approved', 'dismissed')),
  dismiss_reason  TEXT,
  draft_id        UUID,
  ai_output_id    UUID NOT NULL,
  decided_by      UUID,
  decided_at      TIMESTAMPTZ,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, entity_id)    REFERENCES tenancy.entities (tenant_id, id),
  FOREIGN KEY (tenant_id, draft_id)     REFERENCES journals.je_drafts (tenant_id, id),
  FOREIGN KEY (tenant_id, ai_output_id) REFERENCES ai.ai_outputs (tenant_id, id),
  FOREIGN KEY (tenant_id, decided_by)   REFERENCES tenancy.users (tenant_id, id),
  CHECK (status <> 'dismissed' OR dismiss_reason IS NOT NULL),
  CHECK ((status = 'approved') = (draft_id IS NOT NULL))
);
CREATE INDEX proposals_entity_idx ON accruals.proposals (tenant_id, entity_id, period);

-- ---------------------------------------------------------------- v1: recognition
CREATE SCHEMA recognition;
CREATE TABLE recognition.contracts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL,
  entity_id               UUID NOT NULL,
  customer                TEXT NOT NULL,
  code                    TEXT NOT NULL,
  arr                     core.money_amount NOT NULL CHECK (arr >= 0),
  monthly                 core.money_amount NOT NULL CHECK (monthly >= 0),
  currency                core.currency_code NOT NULL,
  owner_name              TEXT NOT NULL,
  schedule_version        TEXT NOT NULL,
  trigger_rule            TEXT NOT NULL,
  evidence                JSONB NOT NULL DEFAULT '[]',
  evidence_found          BOOLEAN NOT NULL,
  modified_this_period    BOOLEAN NOT NULL DEFAULT false,
  confidence              NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  recommendation          JSONB NOT NULL,
  ai_output_id            UUID,
  column_status           TEXT NOT NULL DEFAULT 'needs_review'
                          CHECK (column_status IN ('needs_review', 'auto_applied', 'started', 'deferred')),
  policy_checks           JSONB NOT NULL DEFAULT '[]',
  decision_action         TEXT CHECK (decision_action IN ('start', 'defer', 'pulled_back')),
  decision_justification  TEXT,
  decided_by              UUID,
  decided_at              TIMESTAMPTZ,
  batch_signed_off        BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, entity_id, code),
  FOREIGN KEY (tenant_id, entity_id)    REFERENCES tenancy.entities (tenant_id, id),
  FOREIGN KEY (tenant_id, ai_output_id) REFERENCES ai.ai_outputs (tenant_id, id),
  FOREIGN KEY (tenant_id, decided_by)   REFERENCES tenancy.users (tenant_id, id),
  CHECK (decision_action <> 'defer' OR length(coalesce(decision_justification, '')) >= 10)
);
CREATE TABLE recognition.auto_apply_policies (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  entity_id         UUID NOT NULL,
  version           INTEGER NOT NULL CHECK (version >= 1),
  status            TEXT NOT NULL CHECK (status IN ('active', 'pending', 'superseded', 'discarded')),
  enabled           BOOLEAN NOT NULL DEFAULT true,
  max_per_item      core.money_amount NOT NULL CHECK (max_per_item >= 0),
  max_pct_revenue   NUMERIC(6,3) NOT NULL CHECK (max_pct_revenue >= 0),
  min_confidence    NUMERIC(4,3) NOT NULL CHECK (min_confidence BETWEEN 0.80 AND 1),
  history_periods   INTEGER NOT NULL CHECK (history_periods >= 0),
  aggregate_cap     core.money_amount NOT NULL,
  proposed_by       UUID,
  approved_by       UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, entity_id, version),
  FOREIGN KEY (tenant_id, entity_id)   REFERENCES tenancy.entities (tenant_id, id),
  FOREIGN KEY (tenant_id, proposed_by) REFERENCES tenancy.users (tenant_id, id),
  FOREIGN KEY (tenant_id, approved_by) REFERENCES tenancy.users (tenant_id, id),
  CHECK (aggregate_cap >= max_per_item),
  CHECK (approved_by IS NULL OR proposed_by IS NULL OR approved_by <> proposed_by)   -- §10.1 two people
);
CREATE UNIQUE INDEX auto_apply_one_active_uq ON recognition.auto_apply_policies (tenant_id, entity_id) WHERE status = 'active';
CREATE UNIQUE INDEX auto_apply_one_pending_uq ON recognition.auto_apply_policies (tenant_id, entity_id) WHERE status = 'pending';
CREATE TABLE recognition.sampling (
  tenant_id    UUID NOT NULL,
  entity_id    UUID NOT NULL,
  period       core.period_month NOT NULL,
  sample_size  INTEGER NOT NULL CHECK (sample_size >= 0),
  checked      INTEGER NOT NULL DEFAULT 0 CHECK (checked >= 0),
  errors       INTEGER NOT NULL DEFAULT 0 CHECK (errors >= 0),
  PRIMARY KEY (tenant_id, entity_id, period),
  FOREIGN KEY (tenant_id, entity_id) REFERENCES tenancy.entities (tenant_id, id),
  CHECK (errors <= checked)
);
CREATE TABLE recognition.monthly_plan (
  tenant_id         UUID NOT NULL,
  entity_id         UUID NOT NULL,
  month             core.period_month NOT NULL,
  planned           core.money_amount NOT NULL,
  recognised_base   core.money_amount NOT NULL,
  PRIMARY KEY (tenant_id, entity_id, month),
  FOREIGN KEY (tenant_id, entity_id) REFERENCES tenancy.entities (tenant_id, id)
);

-- ---------------------------------------------------------------- v1: consolidation
CREATE SCHEMA consolidation;
CREATE TABLE consolidation.periods (
  tenant_id        UUID NOT NULL REFERENCES tenancy.tenants (id),
  period           core.period_month NOT NULL,
  status           TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('not_started', 'in_progress', 'locked')),
  translation_run  BOOLEAN NOT NULL DEFAULT false,
  reviewed         BOOLEAN NOT NULL DEFAULT false,
  locked_by        UUID,
  locked_at        TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, period)
);
CREATE TABLE consolidation.ic_matches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  period            core.period_month NOT NULL,
  from_entity_id    UUID NOT NULL,
  to_entity_id      UUID NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('receivable_payable', 'revenue_expense')),
  from_amount_usd   core.money_amount NOT NULL,
  to_amount_usd     core.money_amount NOT NULL,
  tolerance         core.money_amount NOT NULL CHECK (tolerance >= 0),
  status            TEXT NOT NULL CHECK (status IN ('matched', 'mismatch', 'pending_counterparty')),
  likely_cause      TEXT CHECK (likely_cause IN ('fx', 'timing', 'amount')),
  explanation       TEXT NOT NULL,
  true_up_draft_id  UUID,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, from_entity_id)   REFERENCES tenancy.entities (tenant_id, id),
  FOREIGN KEY (tenant_id, to_entity_id)     REFERENCES tenancy.entities (tenant_id, id),
  FOREIGN KEY (tenant_id, true_up_draft_id) REFERENCES journals.je_drafts (tenant_id, id),
  CHECK (from_entity_id <> to_entity_id)
);
CREATE TABLE consolidation.eliminations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  period       core.period_month NOT NULL,
  ic_match_id  UUID NOT NULL,
  description  TEXT NOT NULL,
  amount       core.money_amount NOT NULL CHECK (amount >= 0),
  status       TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'posted')),
  prepared_by  UUID,                    -- NULL = proposed by the system
  approved_by  UUID,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, ic_match_id) REFERENCES consolidation.ic_matches (tenant_id, id),
  FOREIGN KEY (tenant_id, prepared_by) REFERENCES tenancy.users (tenant_id, id),
  FOREIGN KEY (tenant_id, approved_by) REFERENCES tenancy.users (tenant_id, id),
  CHECK (approved_by IS NULL OR prepared_by IS NULL OR approved_by <> prepared_by),
  CHECK ((status = 'proposed') = (approved_by IS NULL))
);

-- ---------------------------------------------------------------- job queue (TECH-STACK D-2)
CREATE SCHEMA jobs;
CREATE TABLE jobs.jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenancy.tenants (id),
  kind          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  payload       JSONB NOT NULL DEFAULT '{}',
  result        JSONB,
  progress      SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  message       TEXT NOT NULL DEFAULT 'Queued',
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,
  run_after     TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at     TIMESTAMPTZ,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  error         TEXT
);
CREATE INDEX jobs_queue_idx ON jobs.jobs (run_after) WHERE status = 'queued';

-- Claims the next due job across tenants (SKIP LOCKED). It runs as a
-- BYPASSRLS owner because the worker doesn't know the tenant yet; the worker
-- then sets that tenant and does all real work under RLS.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_jobs') THEN CREATE ROLE app_jobs NOLOGIN BYPASSRLS; END IF; END $$;
CREATE FUNCTION jobs.claim_next() RETURNS TABLE (id UUID, tenant_id UUID, kind TEXT, payload JSONB, created_by UUID)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  UPDATE jobs.jobs j
     SET status = 'running', locked_at = now(), attempts = j.attempts + 1, message = 'Running'
   WHERE j.id = (
     SELECT q.id FROM jobs.jobs q
      WHERE q.status = 'queued' AND q.run_after <= now()
      ORDER BY q.run_after
      FOR UPDATE SKIP LOCKED
      LIMIT 1)
  RETURNING j.id, j.tenant_id, j.kind, j.payload, j.created_by
$$;
"""

POST = r"""
DO $$
DECLARE t RECORD;
BEGIN
  FOR t IN
    SELECT table_schema, table_name FROM information_schema.columns
     WHERE column_name = 'tenant_id' AND table_schema IN ('accruals', 'recognition', 'consolidation', 'jobs')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t.table_schema, t.table_name);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', t.table_schema, t.table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I.%I USING (tenant_id = core.current_tenant_id()) WITH CHECK (tenant_id = core.current_tenant_id())', t.table_schema, t.table_name);
    EXECUTE format('ALTER TABLE %I.%I OWNER TO app_migrator', t.table_schema, t.table_name);
  END LOOP;
END $$;

ALTER SCHEMA accruals OWNER TO app_migrator;
ALTER SCHEMA recognition OWNER TO app_migrator;
ALTER SCHEMA consolidation OWNER TO app_migrator;
ALTER SCHEMA jobs OWNER TO app_migrator;

GRANT USAGE ON SCHEMA accruals, recognition, consolidation, jobs TO app_api, app_worker;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA accruals, recognition, consolidation TO app_api, app_worker;
GRANT SELECT, INSERT ON jobs.jobs TO app_api;
GRANT SELECT, INSERT, UPDATE ON jobs.jobs TO app_worker;

GRANT USAGE ON SCHEMA jobs TO app_jobs;
GRANT SELECT, UPDATE ON jobs.jobs TO app_jobs;
ALTER FUNCTION jobs.claim_next() OWNER TO app_jobs;
REVOKE ALL ON FUNCTION jobs.claim_next() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION jobs.claim_next() TO app_worker;
"""


def upgrade() -> None:
    raw = op.get_bind().connection.driver_connection
    raw.execute(SQL)
    raw.execute(POST)


def downgrade() -> None:
    op.execute("DROP SCHEMA IF EXISTS jobs, consolidation, recognition, accruals CASCADE; DROP ROLE IF EXISTS app_jobs;")
