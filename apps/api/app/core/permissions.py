"""Role → permission matrix (ARCHITECTURE §5.3). SOD rules are enforced
separately in services and by database triggers."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

ROLE_PERMS: dict[str, set[str]] = {
    "preparer": {"view", "task.edit", "context.propose", "je.prepare", "recognition.decide"},
    "reviewer": {"view", "task.signoff", "context.propose", "context.approve.account", "recognition.decide"},
    "approver": {"view", "je.approve"},
    "controller": {
        "view", "task.edit", "task.signoff", "context.propose", "context.approve.account", "context.approve.broad",
        "je.prepare", "je.approve", "period.lock", "period.reopen.approve", "thresholds.manage", "audit.view",
        "recognition.decide", "recognition.policy", "consolidation.manage",
    },
    "admin": {"view", "setup.manage", "thresholds.manage"},
    "auditor": {"view", "audit.view"},
}


@dataclass
class Principal:
    tenant_id: Any
    user: dict[str, Any]
    memberships: list[dict[str, Any]]
    auth_time: Any
    perms: dict[str, set[str]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for m in self.memberships:
            key = str(m["entity_id"]) if m["entity_id"] else "*"
            self.perms.setdefault(key, set()).update(ROLE_PERMS.get(m["role"], set()))

    @property
    def id(self) -> Any:
        return self.user["id"]

    @property
    def name(self) -> str:
        return str(self.user["display_name"])

    def can(self, perm: str, entity_id: Any = None) -> bool:
        if perm in self.perms.get("*", set()):
            return True
        if entity_id is not None:
            return perm in self.perms.get(str(entity_id), set())
        return any(perm in ps for ps in self.perms.values())

    def require(self, perm: str, entity_id: Any = None) -> None:
        from app.core.errors import fail

        if not self.can(perm, entity_id):
            raise fail(403, "Not allowed", f'Your role doesn\'t include "{perm}"{" for this entity" if entity_id else ""}.', "forbidden")

    def permissions_json(self) -> dict[str, list[str]]:
        return {k: sorted(v) for k, v in self.perms.items()}
