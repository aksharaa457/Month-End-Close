"""Importing this package registers every job handler with the worker."""

from app.jobs.handlers import close_jobs, setup_jobs, v1_jobs  # noqa: F401
