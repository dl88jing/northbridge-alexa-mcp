"""Strands agent wiring — DemoModel offline + Bedrock live path."""

from __future__ import annotations

import json
import os
from typing import Any

from northbridge.demo_model import DemoModel
from northbridge.ledger import reset_ledger, verify_ledger
from northbridge.tools import (
    TOOL_FUNCS,
    TOOL_NAMES,
    check_funding,
    detect_anomaly,
    list_upcoming_dues,
    mark_auto_handled,
    notify_human,
    parse_bill_status,
    prepare_decision_brief,
    reset_runtime,
    _load_state,
)

SYSTEM_PROMPT = """You are Northbridge Home Ops, a quiet household operations agent
for Avery and Morgan Quinn. You handle bills, calendar dues, and funding checks
through MCP tools. Escalate only when policy says HUMAN_REQUIRED — otherwise
auto-handle silently.

Workflow for each due bill:
1) list_upcoming_dues / parse_bill_status
2) check_funding
3) detect_anomaly (deterministic AUTO vs HUMAN_REQUIRED)
4) If AUTO: mark_auto_handled
5) If HUMAN_REQUIRED: prepare_decision_brief then notify_human
Never invent payees or amounts — always use tools.
"""


def run_offline_pipeline() -> dict[str, Any]:
    """Deterministic offline agent loop using the same Strands tools (no LLM keys)."""
    reset_runtime()
    reset_ledger()

    dues_payload = json.loads(list_upcoming_dues(within_days=45, kind="bill"))
    results: list[dict[str, Any]] = []

    for due in dues_payload["dues"]:
        bill_id = due.get("ref_id")
        if not bill_id or due.get("already_handled"):
            continue

        parse_bill_status(bill_id)
        check_funding(bill_id)
        anomaly = json.loads(detect_anomaly(bill_id))

        if anomaly.get("decision") == "AUTO":
            mark_auto_handled(
                bill_id,
                summary=f"Quietly prepared {anomaly.get('payee', bill_id)}",
            )
            results.append(
                {
                    "bill_id": bill_id,
                    "action": "auto_handled",
                    "decision": "AUTO",
                    "detail": anomaly,
                }
            )
        else:
            brief = json.loads(prepare_decision_brief(bill_id))
            notify_human(
                bill_id,
                reason="; ".join(anomaly.get("reasons", [])) or "needs review",
                recommended_action=brief.get(
                    "recommended_action", "Review before paying"
                ),
            )
            results.append(
                {
                    "bill_id": bill_id,
                    "action": "notify_human",
                    "decision": "HUMAN_REQUIRED",
                    "detail": anomaly,
                    "brief_headline": brief.get("headline"),
                }
            )

    state = _load_state()
    ledger = verify_ledger()
    return {
        "mode": "offline_fixture_pipeline",
        "household": "Northbridge",
        "bills_processed": len(results),
        "auto_handled": [r["bill_id"] for r in results if r["action"] == "auto_handled"],
        "escalated": [r["bill_id"] for r in results if r["action"] == "notify_human"],
        "results": results,
        "state": state,
        "ledger": ledger,
        "strands_tools": TOOL_NAMES,
    }


def build_agent(use_bedrock: bool | None = None):
    """Build a Strands Agent with DemoModel (default) or BedrockModel."""
    from strands import Agent

    if use_bedrock is None:
        use_bedrock = bool(
            os.getenv("AWS_ACCESS_KEY_ID")
            or os.getenv("AWS_PROFILE")
            or os.getenv("AWS_BEARER_TOKEN_BEDROCK")
            or os.getenv("NORTHBRIDGE_USE_BEDROCK")
        )

    if use_bedrock:
        try:
            from strands.models import BedrockModel

            model = BedrockModel(
                model_id=os.getenv(
                    "NORTHBRIDGE_MODEL_ID",
                    "global.anthropic.claude-sonnet-4-6",
                ),
                region_name=os.getenv("AWS_REGION", "us-west-2"),
                temperature=0.2,
            )
            return Agent(
                model=model,
                tools=list(TOOL_FUNCS),
                system_prompt=SYSTEM_PROMPT,
            )
        except Exception as exc:  # pragma: no cover
            print(f"[northbridge] Bedrock unavailable ({exc}); using DemoModel")

    model = DemoModel(summary_provider=run_offline_pipeline)
    return Agent(
        model=model,
        tools=list(TOOL_FUNCS),
        system_prompt=SYSTEM_PROMPT,
    )


def run_with_strands_agent(prompt: str | None = None) -> Any:
    """Run via Strands Agent (Bedrock when configured, else DemoModel)."""
    use_bedrock = bool(
        os.getenv("AWS_ACCESS_KEY_ID")
        or os.getenv("AWS_PROFILE")
        or os.getenv("AWS_BEARER_TOKEN_BEDROCK")
        or os.getenv("NORTHBRIDGE_USE_BEDROCK")
    )
    if not use_bedrock:
        # DemoModel summarizes the pipeline; ensure pipeline actually ran
        pipeline = run_offline_pipeline()
        agent = build_agent(use_bedrock=False)
        # Calling agent re-runs DemoModel summary over already-fresh state
        result = agent(
            prompt
            or "Summarize the Northbridge Home Ops offline pass for Avery and Morgan."
        )
        return {"pipeline": pipeline, "agent_result": str(result)}
    agent = build_agent(use_bedrock=True)
    user_prompt = prompt or (
        "Process all upcoming Northbridge bill dues. Auto-handle safe ones. "
        "Escalate only HUMAN_REQUIRED items with a decision brief."
    )
    return agent(user_prompt)
