"""Paths and runtime constants for Northbridge Home Ops."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
RUNTIME_DIR = DATA_DIR / "runtime"
RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

HOUSEHOLD_PATH = DATA_DIR / "household.json"
BILLS_PATH = DATA_DIR / "bills.json"
CALENDAR_PATH = DATA_DIR / "calendar_dues.json"
FUNDING_PATH = DATA_DIR / "funding_accounts.json"
POLICY_PATH = DATA_DIR / "policy.json"

STATE_PATH = RUNTIME_DIR / "state.json"
LEDGER_PATH = RUNTIME_DIR / "audit_ledger.jsonl"

MCP_HOST = "127.0.0.1"
MCP_PORT = 8765
MCP_PATH = "/mcp"
