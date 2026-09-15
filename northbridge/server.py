"""MCP Streamable HTTP server (MCP 2025-11-25+) plus Control Plane REST for the web sim."""

from __future__ import annotations

import json
from typing import Any

from mcp.server.mcpserver import MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from starlette.requests import Request
from starlette.responses import JSONResponse

from northbridge import __version__
from northbridge.agent import run_offline_pipeline
from northbridge.config import MCP_HOST, MCP_PATH, MCP_PORT
from northbridge.ledger import read_ledger, verify_ledger
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
    _load_json,
    _load_state,
)
from northbridge.config import (
    BILLS_PATH,
    CALENDAR_PATH,
    FUNDING_PATH,
    HOUSEHOLD_PATH,
    POLICY_PATH,
)
from northbridge.ledger import reset_ledger

server = MCPServer(
    name="northbridge-home-ops",
    title="Northbridge Home Ops",
    description=(
        "Self-hosted MCP for quiet household admin — bills, dues, funding, "
        "escalate-only decisions for Alexa+."
    ),
    version=__version__,
    instructions=(
        "Use tools to list dues, parse bills, check funding, detect anomalies, "
        "and either mark_auto_handled (AUTO) or prepare_decision_brief + notify_human "
        "(HUMAN_REQUIRED). Never invent amounts."
    ),
)

# Register the same Strands-decorated callables as MCP tools
for fn in TOOL_FUNCS:
    server.add_tool(fn)


def _cors(resp: JSONResponse) -> JSONResponse:
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


@server.custom_route("/api/health", methods=["GET", "OPTIONS"])
async def api_health(request: Request) -> JSONResponse:
    if request.method == "OPTIONS":
        return _cors(JSONResponse({}))
    return _cors(
        JSONResponse(
            {
                "ok": True,
                "service": "northbridge-home-ops",
                "version": __version__,
                "mcp_path": MCP_PATH,
                "protocol": "streamable-http",
                "tools": TOOL_NAMES,
            }
        )
    )


@server.custom_route("/api/household", methods=["GET", "OPTIONS"])
async def api_household(request: Request) -> JSONResponse:
    if request.method == "OPTIONS":
        return _cors(JSONResponse({}))
    return _cors(
        JSONResponse(
            {
                "household": _load_json(HOUSEHOLD_PATH),
                "policy": _load_json(POLICY_PATH),
                "funding": _load_json(FUNDING_PATH),
                "bills": _load_json(BILLS_PATH),
                "calendar": _load_json(CALENDAR_PATH),
            }
        )
    )


@server.custom_route("/api/state", methods=["GET", "OPTIONS"])
async def api_state(request: Request) -> JSONResponse:
    if request.method == "OPTIONS":
        return _cors(JSONResponse({}))
    return _cors(JSONResponse({"state": _load_state(), "ledger": verify_ledger()}))


@server.custom_route("/api/ledger", methods=["GET", "OPTIONS"])
async def api_ledger(request: Request) -> JSONResponse:
    if request.method == "OPTIONS":
        return _cors(JSONResponse({}))
    limit = int(request.query_params.get("limit", "50"))
    return _cors(
        JSONResponse({"entries": read_ledger(limit=limit), "verify": verify_ledger()})
    )


@server.custom_route("/api/tools", methods=["GET", "OPTIONS"])
async def api_tools(request: Request) -> JSONResponse:
    if request.method == "OPTIONS":
        return _cors(JSONResponse({}))
    catalog = []
    for fn in TOOL_FUNCS:
        catalog.append(
            {
                "name": fn.__name__,
                "description": (fn.__doc__ or "").strip().split("\n")[0],
            }
        )
    return _cors(JSONResponse({"tools": catalog}))


@server.custom_route("/api/tools/call", methods=["POST", "OPTIONS"])
async def api_tools_call(request: Request) -> JSONResponse:
    if request.method == "OPTIONS":
        return _cors(JSONResponse({}))
    body = await request.json()
    name = body.get("name")
    arguments: dict[str, Any] = body.get("arguments") or {}
    dispatch = {fn.__name__: fn for fn in TOOL_FUNCS}
    if name not in dispatch:
        return _cors(JSONResponse({"error": f"Unknown tool {name}"}, status_code=404))
    try:
        raw = dispatch[name](**arguments)
        parsed = json.loads(raw) if isinstance(raw, str) else raw
        return _cors(JSONResponse({"name": name, "arguments": arguments, "result": parsed}))
    except TypeError as exc:
        return _cors(JSONResponse({"error": str(exc)}, status_code=400))
    except Exception as exc:  # pragma: no cover
        return _cors(JSONResponse({"error": str(exc)}, status_code=500))


@server.custom_route("/api/demo/run", methods=["POST", "OPTIONS"])
async def api_demo_run(request: Request) -> JSONResponse:
    if request.method == "OPTIONS":
        return _cors(JSONResponse({}))
    result = run_offline_pipeline()
    return _cors(JSONResponse(result))


@server.custom_route("/api/demo/reset", methods=["POST", "OPTIONS"])
async def api_demo_reset(request: Request) -> JSONResponse:
    if request.method == "OPTIONS":
        return _cors(JSONResponse({}))
    reset_runtime()
    reset_ledger()
    return _cors(JSONResponse({"reset": True}))


@server.custom_route("/api/utterance", methods=["POST", "OPTIONS"])
async def api_utterance(request: Request) -> JSONResponse:
    """Simulate Alexa+ natural language by routing to tools heuristically."""
    if request.method == "OPTIONS":
        return _cors(JSONResponse({}))
    body = await request.json()
    text = (body.get("text") or "").strip().lower()
    steps: list[dict[str, Any]] = []

    def step(name: str, **arguments: Any) -> dict[str, Any]:
        dispatch = {fn.__name__: fn for fn in TOOL_FUNCS}
        raw = dispatch[name](**arguments)
        parsed = json.loads(raw)
        entry = {"tool": name, "arguments": arguments, "result": parsed}
        steps.append(entry)
        return parsed

    speak = "I checked Northbridge Home Ops."

    if any(k in text for k in ("run demo", "process all", "handle everything", "catch me up")):
        result = run_offline_pipeline()
        auto_n = len(result["auto_handled"])
        human_n = len(result["escalated"])
        speak = (
            f"I finished the quiet pass. {auto_n} bills auto-handled. "
            f"{human_n} need a decision from you."
        )
        return _cors(
            JSONResponse(
                {"utterance": body.get("text"), "speak": speak, "pipeline": result, "steps": []}
            )
        )

    if any(k in text for k in ("what is due", "upcoming", "dues", "what's due", "whats due")):
        dues = step("list_upcoming_dues", within_days=30, kind="all")
        speak = f"You have {dues['count']} upcoming items on the Northbridge calendar."
    elif "streamflix" in text or "subscription" in text:
        bill_id = "bill-streamflix-2026-09"
        step("parse_bill_status", bill_id=bill_id)
        anomaly = step("detect_anomaly", bill_id=bill_id)
        if anomaly.get("decision") == "HUMAN_REQUIRED":
            brief = step("prepare_decision_brief", bill_id=bill_id)
            step(
                "notify_human",
                bill_id=bill_id,
                reason="; ".join(anomaly.get("reasons", [])),
                recommended_action=brief.get("recommended_action", "Review"),
            )
            speak = brief.get("alexa_speak") or "StreamFlix needs a decision."
        else:
            step("mark_auto_handled", bill_id=bill_id)
            speak = "StreamFlix looks routine — I handled it quietly."
    elif "dental" in text or "medical" in text:
        bill_id = "bill-dental-2026-09"
        step("parse_bill_status", bill_id=bill_id)
        anomaly = step("detect_anomaly", bill_id=bill_id)
        brief = step("prepare_decision_brief", bill_id=bill_id)
        step(
            "notify_human",
            bill_id=bill_id,
            reason="; ".join(anomaly.get("reasons", [])),
            recommended_action=brief.get("recommended_action", "Review"),
        )
        speak = brief.get("alexa_speak") or "Dental bill needs you."
    elif "duplicate" in text or "pge" in text or "pg&e" in text:
        bill_id = "bill-pge-dup-2026-09"
        anomaly = step("detect_anomaly", bill_id=bill_id)
        brief = step("prepare_decision_brief", bill_id=bill_id)
        step(
            "notify_human",
            bill_id=bill_id,
            reason="; ".join(anomaly.get("reasons", [])),
            recommended_action=brief.get("recommended_action", "Review"),
        )
        speak = brief.get("alexa_speak") or "Possible duplicate PG&E charge."
    elif "funding" in text or "balance" in text:
        step("check_funding", bill_id="bill-rent-2026-09")
        speak = "I checked funding for rent against the joint checking reserve floor."
    else:
        dues = step("list_upcoming_dues", within_days=14, kind="bill")
        speak = (
            f"Northbridge has {dues['count']} bill dues in the next two weeks. "
            "Ask me to run the quiet pass, or ask about StreamFlix, dental, or PG&E."
        )

    return _cors(
        JSONResponse({"utterance": body.get("text"), "speak": speak, "steps": steps})
    )


def main() -> None:
    print(
        f"Northbridge MCP listening on http://{MCP_HOST}:{MCP_PORT}{MCP_PATH} "
        f"(Control Plane REST under /api/*)"
    )
    # Disable DNS-rebinding protection for local Vite proxy / simulator
    security = TransportSecuritySettings(
        enable_dns_rebinding_protection=False,
    )
    server.run(
        transport="streamable-http",
        host=MCP_HOST,
        port=MCP_PORT,
        streamable_http_path=MCP_PATH,
        transport_security=security,
        stateless_http=True,
        json_response=True,
    )


if __name__ == "__main__":
    main()
