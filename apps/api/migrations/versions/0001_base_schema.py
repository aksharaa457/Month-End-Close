"""Base schema: database/schema.sql (DATABASE.md), loaded verbatim.

Revision ID: 0001
"""
from pathlib import Path

from alembic import op

revision = "0001"
down_revision = None

_here = Path(__file__).resolve()
# Repo checkout: <repo>/apps/api/migrations/versions → <repo>/database. Container: /srv/database.
SCHEMA = next(p for p in (_here.parents[4] / "database" / "schema.sql", Path("/srv/database/schema.sql")) if p.exists())


def upgrade() -> None:
    sql = SCHEMA.read_text()
    # Alembic already wraps the migration in a transaction.
    sql = sql.replace("\nBEGIN;\n", "\n").replace("\nCOMMIT;\n", "\n")
    # Raw driver call: no parameters, so "%" in format() strings is not a placeholder.
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    op.execute("DROP SCHEMA IF EXISTS audit, ai, journals, flux, close, brain, tenancy, auth, core CASCADE")
