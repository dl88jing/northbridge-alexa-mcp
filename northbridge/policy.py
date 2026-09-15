"""Deterministic AUTO vs HUMAN_REQUIRED policy engine."""

from __future__ import annotations

import json
from typing import Any

from northbridge.config import POLICY_PATH


def load_policy() -> dict[str, Any]:
    with POLICY_PATH.open() as f:
        return json.load(f)


def evaluate_decision(
    *,
    bill: dict[str, Any],
    anomalies: list[str],
    funding: dict[str, Any] | None,
) -> dict[str, Any]:
    """Return {decision: AUTO|HUMAN_REQUIRED, reasons: [...], rule_ids: [...]}."""
    policy = load_policy()
    reasons: list[str] = []
    rule_ids: list[str] = []

    category = (bill.get("category") or "unknown").lower()
    sensitive = {"medical", "tax", "legal", "unknown"}
    if category in sensitive:
        reasons.append(f"Sensitive category '{category}' always escalates")
        rule_ids.append("category_sensitive")

    for a in anomalies:
        if a.startswith("amount_unexpected"):
            reasons.append(a)
            rule_ids.append("amount_out_of_band")
        elif a.startswith("duplicate_charge"):
            reasons.append(a)
            rule_ids.append("duplicate_charge")
        else:
            reasons.append(a)
            rule_ids.append("other_anomaly")

    if funding and not funding.get("sufficient", True):
        reasons.append(funding.get("reason") or "Insufficient funding vs reserve floor")
        rule_ids.append("insufficient_funding")

    auto_cats = set(policy.get("auto_eligible_categories", []))
    if not reasons and category not in auto_cats:
        reasons.append(f"Category '{category}' is not auto-eligible")
        rule_ids.append("category_not_auto")

    if reasons:
        return {
            "decision": "HUMAN_REQUIRED",
            "reasons": reasons,
            "rule_ids": sorted(set(rule_ids)),
            "policy_version": policy.get("version"),
        }

    return {
        "decision": "AUTO",
        "reasons": ["Routine bill within expected band with adequate funding"],
        "rule_ids": ["routine_in_band"],
        "policy_version": policy.get("version"),
    }
