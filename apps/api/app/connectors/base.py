"""Shared ledger interface (ARCHITECTURE §2.2). Only the worker calls these.

- SimulatedLedger: used when a connection's mode is 'simulated' (demo/dev/CI).
- NetSuiteConnector / SapConnector: real adapters. They need sandbox credentials
  in Secrets Manager; until those exist they refuse clearly instead of guessing.
"""

from __future__ import annotations

import hashlib
from typing import Any, Protocol


class Ledger(Protocol):
    name: str

    async def find_by_external_id(self, external_id: str) -> str | None: ...
    async def post_journal(self, external_id: str, draft: dict[str, Any], lines: list[dict[str, Any]]) -> str: ...
    async def fetch_changes(self, since_cursor: str | None) -> dict[str, Any]: ...


class SimulatedLedger:
    """Deterministic stand-in for an ERP. Doc numbers are derived from the
    external id, so re-posting the same key returns the same document."""

    _posted: dict[str, str] = {}

    def __init__(self, erp_type: str):
        self.erp_type = erp_type
        self.name = "SAP (simulated)" if erp_type == "sap" else "NetSuite (simulated)"

    async def find_by_external_id(self, external_id: str) -> str | None:
        return self._posted.get(external_id)

    async def post_journal(self, external_id: str, draft: dict[str, Any], lines: list[dict[str, Any]]) -> str:
        debit = sum(ln["debit"] for ln in lines)
        credit = sum(ln["credit"] for ln in lines)
        if debit != credit:
            raise ValueError("ERP rejected the entry: debits and credits don't balance")
        n = int(hashlib.sha256(external_id.encode()).hexdigest()[:6], 16) % 90000 + 10000
        doc = f"{'SAP-FI' if self.erp_type == 'sap' else 'NS-JE'}-{n}"
        self._posted[external_id] = doc
        return doc

    async def fetch_changes(self, since_cursor: str | None) -> dict[str, Any]:
        return {"lines": 0, "cursor": since_cursor}


class NotConfiguredLedger:
    def __init__(self, erp_type: str):
        self.name = "SAP" if erp_type == "sap" else "NetSuite"

    async def find_by_external_id(self, external_id: str) -> str | None:
        return None

    async def post_journal(self, external_id: str, draft: dict[str, Any], lines: list[dict[str, Any]]) -> str:
        raise RuntimeError(
            f"{self.name} live connector isn't configured yet: add sandbox credentials (Secrets Manager) and the "
            f"{'OData (S/4HANA) or RFC/BAPI (ECC) — see PRD Q2' if self.name == 'SAP' else 'SuiteTalk REST'} adapter settings."
        )

    async def fetch_changes(self, since_cursor: str | None) -> dict[str, Any]:
        raise RuntimeError(f"{self.name} live connector isn't configured yet.")


def connector_for(conn: dict[str, Any] | None) -> Any:
    if not conn:
        raise RuntimeError("No ledger connection for this entity.")
    if conn["mode"] == "simulated":
        return SimulatedLedger(conn["erp_type"])
    return NotConfiguredLedger(conn["erp_type"])
