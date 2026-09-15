"""One-command offline demo for hackathon judges."""

from __future__ import annotations

import json
import sys

from northbridge.agent import run_offline_pipeline
from northbridge.ledger import read_ledger, verify_ledger


def main() -> int:
    print("=" * 64)
    print(" Northbridge Home Ops — offline judge demo")
    print(" Household: Northbridge · Avery & Morgan Quinn")
    print(" Mode: escalate-only · DemoModel / fixture pipeline")
    print("=" * 64)

    result = run_offline_pipeline()

    print("\n▸ Bills processed:", result["bills_processed"])
    print("▸ AUTO handled:   ", ", ".join(result["auto_handled"]) or "(none)")
    print("▸ HUMAN required: ", ", ".join(result["escalated"]) or "(none)")

    print("\n── Per-bill decisions ──")
    for row in result["results"]:
        flag = "AUTO " if row["decision"] == "AUTO" else "HUMAN"
        reasons = row["detail"].get("reasons", [])
        print(f"  [{flag}] {row['bill_id']}: {'; '.join(reasons)[:90]}")

    state = result["state"]
    print("\n── Decision-gate notifications (Alexa+ speakable) ──")
    for note in state.get("notifications", []):
        print(f"  • {note['speakable'][:120]}")

    ledger = verify_ledger()
    print("\n── Audit ledger ──")
    print(f"  chain_ok={ledger.get('ok')} entries={ledger.get('entries')} tip={str(ledger.get('tip_hash', ''))[:16]}…")
    for entry in read_ledger(limit=8):
        print(f"  {entry['ts'][:19]}  {entry['tool']:<24}  decision={entry.get('decision')}")

    print("\n── Strands tools ──")
    print(" ", ", ".join(result["strands_tools"]))

    print("\nDemo complete. Start the MCP + web sim with: ./demo.sh serve")
    print(json.dumps({"ok": True, "auto": result["auto_handled"], "human": result["escalated"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
