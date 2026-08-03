export const API_URL = process.env.NEXT_PUBLIC_MAVIO_API_URL ?? "http://localhost:4000";

const authHeaders = (): Record<string, string> => {
  const key = process.env.NEXT_PUBLIC_MAVIO_ADMIN_API_KEY;
  return key ? { authorization: `Bearer ${key}` } : {};
};

export interface ServerRow {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  sourceType: string;
  transport: { type: string; baseUrl?: string; command?: string };
  tags?: string[];
  version?: string;
}

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface Capabilities {
  tools?: ToolInfo[];
  serverInfo?: { name?: string; version?: string };
}

export async function listServers(): Promise<ServerRow[]> {
  const res = await fetch(`${API_URL}/api/servers`, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(`list servers ${res.status}`);
  return res.json();
}

export async function getServer(id: string): Promise<ServerRow> {
  const res = await fetch(`${API_URL}/api/servers/${id}`, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(`get server ${res.status}`);
  return res.json();
}

export async function getCapabilities(id: string): Promise<Capabilities> {
  const res = await fetch(`${API_URL}/api/servers/${id}/capabilities`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`capabilities ${res.status}`);
  return res.json();
}

export async function importOpenApi(body: {
  id: string;
  workspaceId: string;
  projectId: string;
  url?: string;
  baseUrl?: string;
}): Promise<{ ok: boolean; toolCount: number }> {
  const res = await fetch(`${API_URL}/api/imports/openapi`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok?: boolean; toolCount?: number; message?: string };
  if (!res.ok) throw new Error(json.message ?? `import ${res.status}`);
  return { ok: true, toolCount: json.toolCount ?? 0 };
}

export async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${API_URL}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  return res.json();
}

export async function deleteServer(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/servers/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`delete ${res.status}`);
}
