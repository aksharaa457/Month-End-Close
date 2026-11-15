from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Values come from the environment (prefix CCH_) or .env."""

    model_config = SettingsConfigDict(env_prefix="CCH_", env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://cch_api:cch_api_dev@localhost:5433/cch"
    worker_database_url: str = "postgresql+asyncpg://cch_worker:cch_worker_dev@localhost:5433/cch"
    migration_database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5433/cch"

    # Auth (ARCHITECTURE §6). With no WorkOS client id, a dev identity provider is used.
    dev_idp: bool = True
    workos_client_id: str = ""
    workos_api_key: str = ""
    workos_redirect_uri: str = "http://localhost:5173/auth/callback"
    session_idle_minutes: int = 30
    session_lifetime_hours: int = 12
    cookie_secure: bool = False
    session_cookie: str = "cch_session"
    csrf_cookie: str = "cch_csrf"

    # AI gateway (§11). Without ANTHROPIC_API_KEY the gateway runs in labelled offline mode.
    ai_model: str = "claude-opus-5-5"
    ai_inference_geo: str = ""  # "" = provider default (global); "us" = US-only
    ai_timeout_seconds: float = 60.0

    enable_demo_reset: bool = False
    demo_close_day: int = 4  # "today" in the demo calendar (D+4 of Aug 2026)
    demo_period: str = "2026-08"
    demo_prior_period: str = "2026-07"


@lru_cache
def settings() -> Settings:
    return Settings()
