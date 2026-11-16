from alembic import context
from sqlalchemy import create_engine, pool

from app.core.config import settings

url = context.config.get_main_option("sqlalchemy.url") or settings().migration_database_url


def run() -> None:
    engine = create_engine(url, poolclass=pool.NullPool)
    with engine.connect() as conn:
        context.configure(connection=conn, target_metadata=None, transaction_per_migration=True)
        with context.begin_transaction():
            context.run_migrations()


run()
