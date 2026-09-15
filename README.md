# Northbridge Home Ops

**Amazon Developer Hackathon 2026** submission — self-hosted **MCP server** (Streamable HTTP, MCP 2025-11-25+) for **Alexa+**, plus a polished web simulator.

> Quiet household admin for the fictional **Northbridge** home (**Avery & Morgan Quinn**): bills, calendar dues, funding checks, and **escalate-only** decisions. Routine work stays silent; humans are pinged only when policy says `HUMAN_REQUIRED`.

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

---

## Live demo

**Public Control Plane / Alexa+ simulator:** [https://northbridge-alexa-mcp.vercel.app](https://northbridge-alexa-mcp.vercel.app)

Same fixture household (Avery & Morgan Quinn), policy, and tool scenarios as the local MCP server — use **Run quiet pass**, ask *“What's due this week?”*, or escalate StreamFlix / dental / PG&E. No AWS keys required.

---

## Why this wins the brief

| Requirement | How Northbridge delivers |
|-------------|--------------------------|
| Alexa+ + MCP | Streamable HTTP MCP server with seven real tools Alexa+ can call |
| AWS Builder | Strands Agents SDK `@tool` surface + `DemoModel` offline + documented Bedrock path |
| Trust | Hash-chained append-only audit ledger for every tool call |
| Delight | Warm-paper Control Plane web sim (Fraunces + Source Sans, sage/copper on ivory) |
| Judgeable offline | `./demo.sh` — one command, no AWS keys |

---

## Judge quickstart (offline, ~60 seconds)

```bash
git clone https://github.com/dl88jing/northbridge-alexa-mcp.git
cd northbridge-alexa-mcp
./demo.sh
```

Expected highlights:

- **AUTO:** PG&E (in-band), Cascadia Fiber, Rent  
- **HUMAN_REQUIRED:** StreamFlix (amount jump), PG&E duplicate, Bayview Dental (medical)

### Full interactive demo (MCP + web sim)

```bash
# Terminal 1 — MCP Control Plane
./demo.sh serve

# Terminal 2 — Alexa+ web simulator
./demo.sh web
```

Open **http://127.0.0.1:5173** — ask *“What's due this week?”* or click **Run quiet pass**.

Or one process pair: `./demo.sh all`

---

## Product story

Avery and Morgan do not want another dashboard. They want Northbridge to:

1. See what is due  
2. Check funding against reserve floors  
3. Detect anomalies (unexpected amounts, duplicates, sensitive categories)  
4. **Auto-handle** the boring safe bills  
5. **Escalate once**, with a speakable brief, when a real decision is required  

That is the Alexa+ experience: a short conversation backed by durable MCP tools and an auditable ledger.

---

## Architecture

```
Alexa+  /  Web Simulator
        │  Streamable HTTP MCP (/mcp) + REST Control Plane (/api/*)
        ▼
northbridge.server (MCPServer)
        │
        ├─ Strands @tool functions (shared with Agent)
        ├─ Deterministic policy: AUTO vs HUMAN_REQUIRED
        ├─ Fixture household data under data/
        └─ Hash-chained audit ledger (data/runtime/audit_ledger.jsonl)

Strands Agents SDK
  • DemoModel  → offline judge path (no keys)
  • BedrockModel → live Amazon Bedrock path
```

Details: [docs/architecture.md](docs/architecture.md)

---

## MCP tools

| Tool | Purpose |
|------|---------|
| `list_upcoming_dues` | Upcoming calendar dues (bills / admin / reminders) |
| `parse_bill_status` | Normalize a bill for reasoning |
| `check_funding` | Available balance vs reserve floor |
| `detect_anomaly` | Amount band, duplicates, policy decision |
| `prepare_decision_brief` | Concise speakable brief for Avery/Morgan |
| `mark_auto_handled` | Quiet AUTO completion |
| `notify_human` | Escalate-only Alexa+ decision-gate ping |

Protocol: **Streamable HTTP** at `http://127.0.0.1:8765/mcp` (stateless JSON responses for easy local demos).

---

## How Alexa+ is used

1. Northbridge runs as a **self-hosted MCP server** on Streamable HTTP.  
2. Alexa+ connects to that MCP endpoint and discovers the tools above.  
3. Utterances like “what’s due” or “handle the quiet pass” map to tool calls.  
4. When policy returns `HUMAN_REQUIRED`, `notify_human` produces **speakable** copy Alexa+ can read back — no dashboard babysitting.  

The Vite/React app is a **faithful simulator** of that loop for judges without device access: same tools, same policy, same ledger.

---

## How AWS / Strands are used

- Every tool is a **Strands Agents SDK** `@tool` callable — one implementation shared by MCP registration and `Agent(tools=...)`.  
- **Offline (default):** `DemoModel` + deterministic `run_offline_pipeline()` — zero cloud credentials.  
- **Live Bedrock:**

```bash
export AWS_REGION=us-west-2
export NORTHBRIDGE_USE_BEDROCK=1
# plus standard AWS credentials with Bedrock access
python -c "from northbridge.agent import run_with_strands_agent; print(run_with_strands_agent())"
```

Optional: `pip install -e '.[bedrock]'` for boto3.

---

## Project layout

```
northbridge/           # MCP server, tools, policy, ledger, DemoModel, Strands agent
web/                   # Vite + React Alexa+ / Control Plane simulator
data/                  # Fixture household, bills, dues, funding, policy
docs/architecture.md   # System design
demo.sh                # One-command offline demo (+ serve/web/all)
LICENSE                # Apache-2.0
```

---

## Manual install

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -e .
python -m northbridge.demo          # offline pipeline
python -m northbridge.server        # MCP + /api on :8765

cd web && npm install && npm run dev
```

---

## Fixture household (fictional)

- **Northbridge** residence — Avery Quinn (ops primary) & Morgan Quinn (ops secondary)  
- Joint checking with reserve floor, HSA, emergency savings  
- Mixed dues engineered to exercise AUTO and HUMAN_REQUIRED paths  

---

## License

Apache License 2.0 — see [LICENSE](LICENSE).

---

## Hackathon track

**Amazon Developer Hackathon 2026** — Alexa+ with self-hosted MCP, AWS Builder story via Strands Agents SDK + Amazon Bedrock.
