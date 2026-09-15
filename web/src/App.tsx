import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ToolInfo } from "./api";

const SUGGESTIONS = [
  "What's due this week?",
  "Run the quiet pass",
  "Check StreamFlix",
  "Look at the dental bill",
  "Is that PG&E a duplicate?",
  "Check funding for rent",
];

export default function App() {
  const [health, setHealth] = useState<{ ok: boolean; version?: string } | null>(null);
  const [household, setHousehold] = useState<any>(null);
  const [state, setState] = useState<any>(null);
  const [ledger, setLedger] = useState<any[]>([]);
  const [ledgerVerify, setLedgerVerify] = useState<any>(null);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [input, setInput] = useState("What's due this week?");
  const [speak, setSpeak] = useState(
    "Good evening. Northbridge Home Ops is ready — bills stay quiet unless you need a decision."
  );
  const [steps, setSteps] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [h, hh, st, led, tl] = await Promise.all([
        api.health(),
        api.household(),
        api.state(),
        api.ledger(),
        api.tools(),
      ]);
      setHealth(h);
      setHousehold(hh);
      setState(st.state);
      setLedger(led.entries || []);
      setLedgerVerify(led.verify);
      setTools(tl.tools || []);
      setError(null);
    } catch (e: any) {
      setHealth({ ok: false });
      setError(e?.message || "MCP Control Plane unreachable — start ./demo.sh serve");
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 8000);
    return () => clearInterval(id);
  }, [refresh]);

  const bills = household?.bills || [];
  const members = household?.household?.members || [];

  const decisionIds = useMemo(
    () => new Set(state?.needs_decision || []),
    [state]
  );
  const handledIds = useMemo(() => new Set(state?.handled || []), [state]);

  async function sendUtterance(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.utterance(text.trim());
      setSpeak(res.speak);
      setSteps(res.steps || []);
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Utterance failed");
    } finally {
      setBusy(false);
    }
  }

  async function runQuietPass() {
    setBusy(true);
    try {
      const res = await api.runDemo();
      setSpeak(
        `Quiet pass complete. ${res.auto_handled?.length || 0} auto-handled, ${
          res.escalated?.length || 0
        } need you.`
      );
      setSteps(
        (res.results || []).map((r: any) => ({
          tool: r.action,
          arguments: { bill_id: r.bill_id },
          result: r,
        }))
      );
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Demo run failed");
    } finally {
      setBusy(false);
    }
  }

  async function resetAll() {
    setBusy(true);
    try {
      await api.reset();
      setSpeak("Runtime state and audit ledger cleared. Ready for a fresh pass.");
      setSteps([]);
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  async function callTool(name: string) {
    setBusy(true);
    try {
      const args: Record<string, unknown> = {};
      if (name === "list_upcoming_dues") {
        args.within_days = 30;
        args.kind = "all";
      } else if (
        [
          "parse_bill_status",
          "check_funding",
          "detect_anomaly",
          "prepare_decision_brief",
          "mark_auto_handled",
        ].includes(name)
      ) {
        args.bill_id = "bill-streamflix-2026-09";
      } else if (name === "notify_human") {
        args.bill_id = "bill-streamflix-2026-09";
        args.reason = "Simulator manual escalate";
        args.recommended_action = "Review in Control Plane";
      }
      const res = await api.callTool(name, args);
      setSteps([{ tool: name, arguments: args, result: res.result }]);
      setSpeak(`Called ${name} via MCP Control Plane.`);
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Tool call failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="brand-kicker">Amazon Developer Hackathon 2026 · Alexa+ MCP</p>
          <h1 className="brand-title">Northbridge Home Ops</h1>
          <p className="brand-sub">
            Quiet household admin for Avery &amp; Morgan Quinn — bills, dues, and
            funding with escalate-only decisions. Self-hosted MCP for Alexa+.
          </p>
        </div>
        <div className="pill-row">
          <span className={`pill ${health?.ok ? "ok" : "warn"}`}>
            <strong>MCP</strong> {health?.ok ? "online" : "offline"}
          </span>
          <span className="pill">
            <strong>v</strong> {health?.version || "—"}
          </span>
          <span className="pill">
            <strong>Ledger</strong>{" "}
            {ledgerVerify?.ok ? `${ledgerVerify.entries || 0} ok` : "broken"}
          </span>
        </div>
      </header>

      {error && (
        <div className="panel" style={{ marginBottom: 16, borderColor: "#e2b4a8" }}>
          <div className="panel-body muted">{error}</div>
        </div>
      )}

      <div className="grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Alexa+ Simulator</h2>
            <div className="pill-row">
              <button className="btn btn-copper" disabled={busy} onClick={runQuietPass}>
                Run quiet pass
              </button>
              <button className="btn btn-ghost" disabled={busy} onClick={resetAll}>
                Reset
              </button>
            </div>
          </div>
          <div className="panel-body">
            <div className="alexa-stage">
              <div className="alexa-label">Alexa+ · Northbridge</div>
              <p className="alexa-speak">{speak}</p>
              <div className="alexa-meta">
                Household {household?.household?.name || "Northbridge"} · escalate-only policy
              </div>
            </div>

            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                sendUtterance(input);
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask Alexa+ about dues, StreamFlix, dental…"
                aria-label="Utterance"
              />
              <button className="btn btn-primary" disabled={busy} type="submit">
                Ask
              </button>
            </form>

            <div className="chips">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="chip"
                  onClick={() => {
                    setInput(s);
                    sendUtterance(s);
                  }}
                >
                  {s}
                </button>
              ))}
            </div>

            {steps.length > 0 && (
              <div className="steps">
                <div className="muted">Tool trace (MCP)</div>
                {steps.map((s, i) => (
                  <div className="step" key={i}>
                    <strong>{s.tool}</strong>
                    <div className="muted">
                      {JSON.stringify(s.arguments || {})}
                      {s.result?.decision ? ` → ${s.result.decision}` : ""}
                      {s.result?.action ? ` → ${s.result.action}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Control Plane</h2>
            <span className="muted">
              {members.map((m: any) => m.name.split(" ")[0]).join(" · ") || "Avery · Morgan"}
            </span>
          </div>
          <div className="panel-body stack">
            <div>
              <div className="muted" style={{ marginBottom: 8 }}>
                Bills &amp; policy gate
              </div>
              <div className="stack">
                {bills.map((b: any) => {
                  const human = decisionIds.has(b.id);
                  const auto = handledIds.has(b.id);
                  return (
                    <div className="card" key={b.id}>
                      <div className="card-title">
                        <strong>{b.payee}</strong>
                        {human ? (
                          <span className="tag human">Human</span>
                        ) : auto ? (
                          <span className="tag auto">Auto</span>
                        ) : (
                          <span className="tag" style={{ background: "#eee7da" }}>
                            Open
                          </span>
                        )}
                      </div>
                      <div className="muted">
                        ${Number(b.amount).toFixed(2)} · due {b.due_date} · {b.category}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="muted" style={{ marginBottom: 8 }}>
                MCP tools
              </div>
              <div className="tool-grid">
                {tools.map((t) => (
                  <button
                    key={t.name}
                    className="tool-btn"
                    type="button"
                    disabled={busy}
                    onClick={() => callTool(t.name)}
                    title={t.description}
                  >
                    {t.name}
                    <small>{t.description.slice(0, 48)}…</small>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <h2>Hash-chained audit ledger</h2>
          <span className="muted">
            append-only · sha256 tip{" "}
            {ledgerVerify?.tip_hash ? String(ledgerVerify.tip_hash).slice(0, 12) + "…" : "—"}
          </span>
        </div>
        <div className="panel-body">
          <div className="ledger">
            {ledger.length === 0 && (
              <div className="ledger-row">
                <span>—</span>
                <span>No entries yet — run the quiet pass</span>
                <span></span>
              </div>
            )}
            {[...ledger].reverse().map((e) => (
              <div className="ledger-row" key={e.entry_hash}>
                <span>{String(e.ts).replace("T", " ").slice(0, 19)}</span>
                <span>{e.tool}</span>
                <span>{e.decision || "—"}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <p className="footer-note">
        Self-hosted Streamable HTTP MCP · Strands Agents SDK (DemoModel offline / Bedrock live) ·
        Apache-2.0
      </p>
    </div>
  );
}
