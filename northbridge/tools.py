"""Northbridge MCP / Strands tools for quiet household ops."""

from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path
from typing import Any, Callable

from strands import tool

from northbridge.config import (
    BILLS_PATH,
    CALENDAR_PATH,
    FUNDING_PATH,
    HOUSEHOLD_PATH,
    RUNTIME_DIR,
    STATE_PATH,
)
from northbridge.ledger import append_ledger
from northbridge.policy import evaluate_decision

# Optional audit hook — set False for nested helper calls if needed
_AUDIT = True


def _load_json(path: Path) -> Any:
    with path.open() as f:
        return json.load(f)


def _load_state() -> dict[str, Any]:
    if STATE_PATH.exists():
        with STATE_PATH.open() as f:
            return json.load(f)
    return {
        "handled": [],
        "needs_decision": [],
        "briefs": [],
        "notifications": [],
        "auto_summaries": [],
    }


def _save_state(state: dict[str, Any]) -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    with STATE_PATH.open("w") as f:
        json.dump(state, f, indent=2)


def reset_runtime() -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    for path in RUNTIME_DIR.glob("*"):
        if path.name == ".gitkeep":
            continue
        path.unlink()
    _save_state(
        {
            "handled": [],
            "needs_decision": [],
            "briefs": [],
            "notifications": [],
            "auto_summaries": [],
        }
    )


def _audit(tool_name: str, arguments: dict[str, Any], result: Any, decision: str | None = None) -> None:
    if _AUDIT:
        append_ledger(tool_name, arguments, result, decision=decision)


def _bills() -> list[dict[str, Any]]:
    return _load_json(BILLS_PATH)


def _bill_by_id(bill_id: str) -> dict[str, Any] | None:
    return next((b for b in _bills() if b["id"] == bill_id), None)


def _funding_by_id(account_id: str) -> dict[str, Any] | None:
    return next((a for a in _load_json(FUNDING_PATH) if a["id"] == account_id), None)


def _parse_due(d: str) -> date:
    return date.fromisoformat(d)


@tool
def list_upcoming_dues(within_days: int = 30, kind: str = "all") -> str:
    """List upcoming household dues from the calendar (bills, admin, reminders).

    Args:
        within_days: Include items due within this many days from 2026-09-15 (demo "today").
        kind: Filter by kind: all | bill | admin | reminder.
    """
    today = date(2026, 9, 15)  # fixed demo clock for deterministic judging
    calendar = _load_json(CALENDAR_PATH)
    state = _load_state()
    handled = set(state.get("handled", []))

    items = []
    for row in calendar:
        due = _parse_due(row["due_date"])
        delta = (due - today).days
        if delta < 0 or delta > within_days:
            continue
        if kind != "all" and row.get("kind") != kind:
            continue
        ref = row.get("ref_id")
        items.append(
            {
                **row,
                "days_until_due": delta,
                "already_handled": bool(ref and ref in handled),
            }
        )
    items.sort(key=lambda x: (x["due_date"], x.get("priority") != "high"))
    payload = {
        "as_of": today.isoformat(),
        "household": _load_json(HOUSEHOLD_PATH)["name"],
        "count": len(items),
        "dues": items,
    }
    _audit("list_upcoming_dues", {"within_days": within_days, "kind": kind}, payload)
    return json.dumps(payload, indent=2)


@tool
def parse_bill_status(bill_id: str) -> str:
    """Parse a bill into a normalized status summary for Alexa+ / agent reasoning."""
    bill = _bill_by_id(bill_id)
    if not bill:
        err = {"error": f"Unknown bill_id {bill_id}"}
        _audit("parse_bill_status", {"bill_id": bill_id}, err)
        return json.dumps(err)
    low, high = bill.get("expected_amount_range", [bill["amount"], bill["amount"]])
    state = _load_state()
    summary = {
        "id": bill["id"],
        "payee": bill["payee"],
        "amount": bill["amount"],
        "currency": bill.get("currency", "USD"),
        "due_date": bill["due_date"],
        "category": bill["category"],
        "status": bill.get("status", "due"),
        "autopay": bill.get("autopay", False),
        "expected_low": low,
        "expected_high": high,
        "in_expected_band": low <= bill["amount"] <= high,
        "funding_account_id": bill.get("funding_account_id"),
        "account_last4": bill.get("account_last4"),
        "notes": bill.get("notes", ""),
        "handled": bill_id in state.get("handled", []),
        "needs_decision": bill_id in state.get("needs_decision", []),
    }
    _audit("parse_bill_status", {"bill_id": bill_id}, summary)
    return json.dumps(summary, indent=2)


@tool
def check_funding(bill_id: str) -> str:
    """Check whether the mapped funding account can cover the bill above its reserve floor."""
    bill = _bill_by_id(bill_id)
    if not bill:
        err = {"error": f"Unknown bill_id {bill_id}"}
        _audit("check_funding", {"bill_id": bill_id}, err)
        return json.dumps(err)
    account = _funding_by_id(bill.get("funding_account_id", ""))
    if not account:
        err = {
            "bill_id": bill_id,
            "sufficient": False,
            "reason": "No funding account mapped",
        }
        _audit("check_funding", {"bill_id": bill_id}, err, decision="HUMAN_REQUIRED")
        return json.dumps(err)

    available = float(account["available_balance"])
    floor = float(account.get("reserve_floor", 0))
    amount = float(bill["amount"])
    spendable = available - floor
    sufficient = spendable >= amount
    payload = {
        "bill_id": bill_id,
        "payee": bill["payee"],
        "amount": amount,
        "account_id": account["id"],
        "account_name": account["name"],
        "available_balance": available,
        "reserve_floor": floor,
        "spendable_above_floor": round(spendable, 2),
        "sufficient": sufficient,
        "reason": None
        if sufficient
        else f"Need ${amount:.2f} but only ${spendable:.2f} above reserve floor ${floor:.2f}",
    }
    decision = "AUTO" if sufficient else "HUMAN_REQUIRED"
    _audit("check_funding", {"bill_id": bill_id}, payload, decision=decision)
    return json.dumps(payload, indent=2)


@tool
def detect_anomaly(bill_id: str) -> str:
    """Detect anomalies: amount outside expected range, or duplicate payee/amount/due_date."""
    bills = _bills()
    bill = _bill_by_id(bill_id)
    if not bill:
        err = {"error": f"Unknown bill_id {bill_id}"}
        _audit("detect_anomaly", {"bill_id": bill_id}, err)
        return json.dumps(err)

    anomalies: list[str] = []
    low, high = bill.get("expected_amount_range", [bill["amount"], bill["amount"]])
    if bill["amount"] < low or bill["amount"] > high:
        anomalies.append(
            f"amount_unexpected: {bill['amount']} outside expected [{low}, {high}]"
        )

    # Only flag as duplicate when another open twin exists with a smaller id
    # (keeps the earliest/primary bill AUTO-eligible; escalates the copy).
    duplicates = [
        other["id"]
        for other in bills
        if other["id"] != bill_id
        and other["payee"] == bill["payee"]
        and other["amount"] == bill["amount"]
        and other["due_date"] == bill["due_date"]
        and other.get("status") == "due"
        and other["id"] < bill_id
    ]
    if duplicates:
        anomalies.append(f"duplicate_charge: mirrors {', '.join(duplicates)}")

    funding = json.loads(check_funding(bill_id))
    # Avoid double-counting audit noise from nested call — already audited
    decision_info = evaluate_decision(bill=bill, anomalies=anomalies, funding=funding)
    payload = {
        "bill_id": bill_id,
        "payee": bill["payee"],
        "anomalies": anomalies,
        "funding_sufficient": funding.get("sufficient"),
        "decision": decision_info["decision"],
        "reasons": decision_info["reasons"],
        "rule_ids": decision_info["rule_ids"],
        "needs_human_decision": decision_info["decision"] == "HUMAN_REQUIRED",
        "safe_to_auto_handle": decision_info["decision"] == "AUTO",
    }
    _audit(
        "detect_anomaly",
        {"bill_id": bill_id},
        payload,
        decision=decision_info["decision"],
    )
    return json.dumps(payload, indent=2)


@tool
def prepare_decision_brief(bill_id: str) -> str:
    """Prepare a concise decision brief for Avery/Morgan when human judgment is required."""
    bill = _bill_by_id(bill_id)
    if not bill:
        err = {"error": f"Unknown bill_id {bill_id}"}
        _audit("prepare_decision_brief", {"bill_id": bill_id}, err)
        return json.dumps(err)

    anomaly = json.loads(detect_anomaly(bill_id))
    funding = json.loads(check_funding(bill_id))
    status = json.loads(parse_bill_status(bill_id))

    recommended = "Approve payment as-is"
    if any("duplicate" in a for a in anomaly.get("anomalies", [])):
        recommended = "Dismiss duplicate — keep the original PG&E bill only"
    elif any("amount_unexpected" in a for a in anomaly.get("anomalies", [])):
        recommended = "Confirm new amount with payee / cancel unexpected plan change"
    elif bill.get("category") == "medical":
        recommended = "Confirm insurance remittance, then approve remainder from HSA"
    elif not funding.get("sufficient"):
        recommended = "Move funds above reserve floor, then re-run check_funding"

    brief = {
        "bill_id": bill_id,
        "headline": f"{bill['payee']} — ${bill['amount']:.2f} due {bill['due_date']}",
        "decision": anomaly.get("decision"),
        "why": anomaly.get("reasons", []),
        "status": status,
        "funding": {
            "account": funding.get("account_name"),
            "sufficient": funding.get("sufficient"),
            "spendable_above_floor": funding.get("spendable_above_floor"),
        },
        "recommended_action": recommended,
        "alexa_speak": (
            "I need a decision on "
            + bill["payee"]
            + ". "
            + "; ".join(anomaly.get("reasons", []))
            + ". I recommend: "
            + recommended
            + "."
        ),
    }
    state = _load_state()
    state.setdefault("briefs", []).append(brief)
    _save_state(state)
    _audit(
        "prepare_decision_brief",
        {"bill_id": bill_id},
        brief,
        decision=brief.get("decision"),
    )
    return json.dumps(brief, indent=2)


@tool
def mark_auto_handled(bill_id: str, summary: str = "") -> str:
    """Mark a routine bill as quietly auto-handled — no human ping."""
    bill = _bill_by_id(bill_id)
    if not bill:
        err = {"error": f"Unknown bill_id {bill_id}"}
        _audit("mark_auto_handled", {"bill_id": bill_id, "summary": summary}, err)
        return json.dumps(err)

    anomaly = json.loads(detect_anomaly(bill_id))
    if anomaly.get("decision") != "AUTO":
        err = {
            "handled": False,
            "bill_id": bill_id,
            "error": "Policy is HUMAN_REQUIRED — use notify_human / prepare_decision_brief",
            "decision": anomaly.get("decision"),
            "reasons": anomaly.get("reasons"),
        }
        _audit(
            "mark_auto_handled",
            {"bill_id": bill_id, "summary": summary},
            err,
            decision="HUMAN_REQUIRED",
        )
        return json.dumps(err)

    summary = summary or (
        f"Auto-prepared {bill['payee']} (${bill['amount']}) due {bill['due_date']}"
    )
    state = _load_state()
    if bill_id not in state.setdefault("handled", []):
        state["handled"].append(bill_id)
    state.setdefault("auto_summaries", []).append(
        {"bill_id": bill_id, "summary": summary, "at": datetime.utcnow().isoformat() + "Z"}
    )
    _save_state(state)
    payload = {"handled": True, "bill_id": bill_id, "summary": summary, "decision": "AUTO"}
    _audit("mark_auto_handled", {"bill_id": bill_id, "summary": summary}, payload, decision="AUTO")
    return json.dumps(payload, indent=2)


@tool
def notify_human(bill_id: str, reason: str, recommended_action: str) -> str:
    """Escalate to Avery/Morgan only when a real decision is required (Alexa+ speakable ping)."""
    bill = _bill_by_id(bill_id)
    if not bill:
        err = {"error": f"Unknown bill_id {bill_id}"}
        _audit(
            "notify_human",
            {"bill_id": bill_id, "reason": reason, "recommended_action": recommended_action},
            err,
        )
        return json.dumps(err)

    note = {
        "bill_id": bill_id,
        "payee": bill["payee"],
        "amount": bill["amount"],
        "reason": reason,
        "recommended_action": recommended_action,
        "channel": "alexa_plus_decision_gate",
        "speakable": (
            f"Northbridge needs you on {bill['payee']}. {reason}. "
            f"Suggested next step: {recommended_action}."
        ),
    }
    state = _load_state()
    state.setdefault("notifications", []).append(note)
    if bill_id not in state.setdefault("needs_decision", []):
        state["needs_decision"].append(bill_id)
    _save_state(state)
    payload = {"notified": True, "notification": note, "decision": "HUMAN_REQUIRED"}
    _audit(
        "notify_human",
        {"bill_id": bill_id, "reason": reason, "recommended_action": recommended_action},
        payload,
        decision="HUMAN_REQUIRED",
    )
    return json.dumps(payload, indent=2)


# Public tool list for Strands Agent + MCP registration
TOOL_FUNCS: list[Callable[..., str]] = [
    list_upcoming_dues,
    parse_bill_status,
    check_funding,
    detect_anomaly,
    prepare_decision_brief,
    mark_auto_handled,
    notify_human,
]

TOOL_NAMES = [t.__name__ for t in TOOL_FUNCS]
