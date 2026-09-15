export type ToolInfo = { name: string; description: string };

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => req<{ ok: boolean; tools: string[]; version: string }>("/api/health"),
  household: () => req<any>("/api/household"),
  state: () => req<any>("/api/state"),
  ledger: () => req<{ entries: any[]; verify: any }>("/api/ledger?limit=40"),
  tools: () => req<{ tools: ToolInfo[] }>("/api/tools"),
  callTool: (name: string, arguments_: Record<string, unknown> = {}) =>
    req<any>("/api/tools/call", {
      method: "POST",
      body: JSON.stringify({ name, arguments: arguments_ }),
    }),
  runDemo: () => req<any>("/api/demo/run", { method: "POST", body: "{}" }),
  reset: () => req<any>("/api/demo/reset", { method: "POST", body: "{}" }),
  utterance: (text: string) =>
    req<{ speak: string; steps: any[]; pipeline?: any }>("/api/utterance", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
};
