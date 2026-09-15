"""Hash-chained append-only audit ledger for tool calls."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from northbridge.config import LEDGER_PATH


def _canonical(payload: dict[str, Any]) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def _hash(prev_hash: str, entry_body: dict[str, Any]) -> str:
    material = prev_hash + _canonical(entry_body)
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _read_last_hash(path: Path) -> str:
    if not path.exists() or path.stat().st_size == 0:
        return "0" * 64
    last = ""
    with path.open() as f:
        for line in f:
            if line.strip():
                last = line
    if not last:
        return "0" * 64
    return json.loads(last)["entry_hash"]


def append_ledger(
    tool_name: str,
    arguments: dict[str, Any],
    result: Any,
    *,
    decision: str | None = None,
    path: Path | None = None,
) -> dict[str, Any]:
    """Append a hash-chained audit entry. Returns the entry written."""
    ledger_path = path or LEDGER_PATH
    ledger_path.parent.mkdir(parents=True, exist_ok=True)
    prev = _read_last_hash(ledger_path)
    body = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "tool": tool_name,
        "arguments": arguments,
        "result_digest": hashlib.sha256(
            _canonical({"result": result}).encode("utf-8")
        ).hexdigest()[:16],
        "decision": decision,
        "prev_hash": prev,
    }
    entry_hash = _hash(prev, body)
    entry = {**body, "entry_hash": entry_hash}
    with ledger_path.open("a") as f:
        f.write(json.dumps(entry, sort_keys=True) + "\n")
    return entry


def verify_ledger(path: Path | None = None) -> dict[str, Any]:
    """Verify the hash chain. Returns {ok, entries, error?}."""
    ledger_path = path or LEDGER_PATH
    if not ledger_path.exists():
        return {"ok": True, "entries": 0, "message": "empty ledger"}
    prev = "0" * 64
    count = 0
    with ledger_path.open() as f:
        for line_no, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            entry = json.loads(line)
            body = {k: v for k, v in entry.items() if k != "entry_hash"}
            expected = _hash(prev, body)
            if entry.get("prev_hash") != prev:
                return {
                    "ok": False,
                    "entries": count,
                    "error": f"prev_hash mismatch at line {line_no}",
                }
            if entry.get("entry_hash") != expected:
                return {
                    "ok": False,
                    "entries": count,
                    "error": f"entry_hash mismatch at line {line_no}",
                }
            prev = entry["entry_hash"]
            count += 1
    return {"ok": True, "entries": count, "tip_hash": prev}


def read_ledger(limit: int = 50, path: Path | None = None) -> list[dict[str, Any]]:
    ledger_path = path or LEDGER_PATH
    if not ledger_path.exists():
        return []
    rows: list[dict[str, Any]] = []
    with ledger_path.open() as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))
    return rows[-limit:]


def reset_ledger(path: Path | None = None) -> None:
    ledger_path = path or LEDGER_PATH
    if ledger_path.exists():
        ledger_path.unlink()
