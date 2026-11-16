"""Allow replacing the lines of a DRAFT entry. The freeze_lines trigger still
blocks any insert/update/delete once the entry leaves 'draft' (JE-6).

Revision ID: 0003
Revises: 0002
"""

from alembic import op

revision = "0003"
down_revision = "0002"


def upgrade() -> None:
    op.execute("GRANT DELETE ON journals.je_lines TO app_api, app_worker")


def downgrade() -> None:
    op.execute("REVOKE DELETE ON journals.je_lines FROM app_api, app_worker")
