# Architecture — Northbridge Home Ops

## Intent

Northbridge is a **self-hosted MCP server** that lets Alexa+ (and a web simulator) run quiet household admin for the fictional **Northbridge** home (Avery & Morgan Quinn). The agent auto-handles routine bills and **only escalates** when policy says `HUMAN_REQUIRED`.

## Layers

```
┌─────────────────────────────────────────────────────────┐
│  Alexa+  ·  Web Simulator (Vite/React Control Plane)    │
└───────────────────────────┬─────────────────────────────┘
                            │ Streamable HTTP MCP + /api/*
┌───────────────────────────▼─────────────────────────────┐
│  northbridge.server  (MCPServer, MCP 2025-11-25+)       │
│  tools registered from Strands @tool callables          │
└───────────────────────────┬─────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌─────────────────┐
│ Policy engine │   │ Fixture data  │   │ Hash-chained    │
│ AUTO / HUMAN  │   │ data/*.json   │   │ audit ledger    │
└───────────────┘   └───────────────┘   └─────────────────┘
                            │
                ┌───────────▼───────────┐
                │ Strands Agents SDK    │
                │ DemoModel (offline)   │
                │ BedrockModel (live)   │
                └───────────────────────┘
```

## MCP tools

| Tool | Role |
|------|------|
| `list_upcoming_dues` | Calendar dues window |
| `parse_bill_status` | Normalize a bill |
| `check_funding` | Balance vs reserve floor |
| `detect_anomaly` | Amount band + duplicates + policy decision |
| `prepare_decision_brief` | Speakable brief for humans |
| `mark_auto_handled` | Quiet AUTO path |
| `notify_human` | Escalate-only Alexa+ ping |

## Policy

Deterministic rules in `data/policy.json` / `northbridge/policy.py`:

- Amount outside expected band → `HUMAN_REQUIRED`
- Duplicate payee+amount+due → `HUMAN_REQUIRED`
- Category medical/tax/legal/unknown → `HUMAN_REQUIRED`
- Insufficient spendable funds above reserve → `HUMAN_REQUIRED`
- Otherwise auto-eligible category → `AUTO`

## Audit ledger

`data/runtime/audit_ledger.jsonl` is **append-only**. Each entry stores `prev_hash` and `entry_hash = sha256(prev_hash || canonical(body))`. `verify_ledger()` walks the chain.

## Alexa+ angle

Alexa+ connects to the **self-hosted Streamable HTTP MCP** endpoint (`/mcp`). The web simulator mirrors that experience: utterances route into the same tools, and escalations return speakable copy (`alexa_speak` / `speakable`).

## AWS Builder angle

- Tools are Strands `@tool` functions — identical surface for MCP and `Agent(tools=...)`.
- Offline: `DemoModel` + `run_offline_pipeline()` (no AWS keys).
- Live: `BedrockModel` via Amazon Bedrock when credentials are present (`NORTHBRIDGE_USE_BEDROCK=1` or standard AWS env).
