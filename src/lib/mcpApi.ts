/**
 * MCP client for NyaaChat. Talks to the same-origin reverse proxy at
 * /api/mcp (set up in nginx.conf) so the upstream Bearer token never
 * reaches the browser. The MCP server is stateless on this deployment —
 * each POST is a self-contained JSON-RPC request, no `initialize`
 * handshake required.
 *
 * Streamable HTTP responses arrive as Server-Sent Events:
 *   event: message
 *   data: {"jsonrpc":"2.0","id":1,"result":...}
 *
 * We parse a single message frame (the protocol allows more, but every
 * call we make today is one request → one response) and surface the
 * `result` / `error` to callers as a discriminated union. Tool failures
 * are returned, not thrown, because the LLM tool-use loop needs to feed
 * a structured "this attempt failed" signal back into the conversation
 * rather than blow up the whole turn.
 */

const MCP_ENDPOINT = "/api/mcp";
const MCP_HEALTH_ENDPOINT = "/api/mcp/health";

const REQUEST_TIMEOUT_MS = 30_000;
const HEALTH_TIMEOUT_MS = 5_000;

export interface McpTool {
  name: string;
  /** Human-friendly Chinese title supplied by `server.registerTool({title})`.
   *  Falls back to `name` when missing for backward-compat with servers that
   *  predate the title field. */
  title: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

export type McpHealth =
  | { ok: true; latencyMs: number; name?: string; version?: string }
  | { ok: false; latencyMs: number; error: string };

export type McpCallResult =
  | { ok: true; text: string }
  | { ok: false; message: string };

interface JsonRpcSuccess<T> {
  jsonrpc: "2.0";
  id: number | string;
  result: T;
}
interface JsonRpcError {
  jsonrpc: "2.0";
  id: number | string | null;
  error: { code: number; message: string; data?: unknown };
}

interface ToolCallResultPayload {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

let nextRpcId = 1;

async function fetchWithTimeout(
  input: RequestInfo,
  init: RequestInit,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  let timedOut = false;
  const link = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", link, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } catch (err: any) {
    if (err?.name === "AbortError" && timedOut) {
      throw new Error(`请求超时:${Math.round(timeoutMs / 1000)} 秒内未收到响应`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", link);
  }
}

/**
 * Extract the JSON object from an SSE-formatted body. The streamable-HTTP
 * transport may also reply with plain JSON (no `event:`/`data:` prefix)
 * if the upstream chooses not to stream — handle both shapes.
 */
function parseSseOrJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("MCP 服务返回空响应");
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }
  // SSE: walk lines, find the first `data:` payload.
  for (const line of trimmed.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      const payload = line.slice(5).trim();
      if (payload && payload !== "[DONE]") return JSON.parse(payload);
    }
  }
  throw new Error("MCP 服务响应格式无法解析");
}

async function rpc<T>(
  method: string,
  params: Record<string, unknown>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<T> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: nextRpcId++,
    method,
    params,
  });

  const res = await fetchWithTimeout(
    MCP_ENDPOINT,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body,
      referrerPolicy: "no-referrer",
    },
    signal,
    timeoutMs,
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // 401 means the reverse proxy didn't inject the Bearer correctly. Surface
    // a clear hint so the operator can re-check .env / nginx envsubst rather
    // than chase a JSON-RPC error.
    if (res.status === 401) {
      throw new Error("MCP 鉴权失败（HTTP 401）：检查 .env 中的 MCP_API_KEY 是否与上游一致");
    }
    throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const parsed = parseSseOrJson(await res.text()) as
    | JsonRpcSuccess<T>
    | JsonRpcError;
  if ("error" in parsed) {
    const e = parsed.error;
    throw new Error(`MCP 错误 ${e.code}: ${e.message}`);
  }
  return parsed.result;
}

/**
 * Health probe. Resolves on both success and failure with a discriminated
 * payload — never throws — so the UI can drive the indicator dot directly
 * without try/catch.
 */
export async function ping(signal?: AbortSignal): Promise<McpHealth> {
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(
      MCP_HEALTH_ENDPOINT,
      { method: "GET", referrerPolicy: "no-referrer" },
      signal,
      HEALTH_TIMEOUT_MS,
    );
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return { ok: false, latencyMs, error: `HTTP ${res.status}` };
    }
    const body = await res.json().catch(() => ({}) as any);
    return {
      ok: body?.status === "ok",
      latencyMs,
      name: body?.name,
      version: body?.version,
      ...(body?.status === "ok"
        ? {}
        : { error: typeof body?.status === "string" ? body.status : "unhealthy" }),
    } as McpHealth;
  } catch (err: any) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err?.message || "网络错误",
    };
  }
}

export async function listTools(signal?: AbortSignal): Promise<McpTool[]> {
  const result = await rpc<{ tools: McpTool[] }>("tools/list", {}, signal, REQUEST_TIMEOUT_MS);
  return (result.tools ?? []).map((t) => ({
    ...t,
    title: t.title || t.name,
  }));
}

/**
 * Invoke a tool. Returns a discriminated union covering three failure
 * modes — transport (network / timeout / 401), JSON-RPC protocol error,
 * and tool-side `isError` — collapsed into a single `{ ok: false, message }`
 * so the LLM tool-use loop can turn any of them into a structured failure
 * signal for the next round.
 */
export async function callTool(
  name: string,
  args: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<McpCallResult> {
  let payload: ToolCallResultPayload;
  try {
    payload = await rpc<ToolCallResultPayload>(
      "tools/call",
      { name, arguments: args },
      signal,
      REQUEST_TIMEOUT_MS,
    );
  } catch (err: any) {
    return { ok: false, message: err?.message || "MCP 调用失败" };
  }

  const text = (payload.content ?? [])
    .filter((p) => p?.type === "text" && typeof p.text === "string")
    .map((p) => p.text!)
    .join("\n")
    .trim();

  if (payload.isError) {
    return { ok: false, message: text || "工具返回 isError" };
  }
  if (!text) {
    return { ok: false, message: "工具返回空内容" };
  }
  return { ok: true, text };
}

/**
 * Map a tool to the parameter name that accepts a "where the user is"
 * value. Used by `mergeUserCity` below to inject the user's role-play
 * city into outgoing calls when the LLM didn't pick a location itself.
 *
 * Adding a new MCP tool with a location-style argument? Add a row here so
 * the user's geo setting flows through automatically.
 */
const USER_CITY_PARAM_BY_TOOL: Record<string, string> = {
  get_current_time: "timezone",
  get_weather: "location",
};

/**
 * If the user has set a role-play city in settings AND the LLM didn't
 * specify the location parameter itself, fill the user's city in as the
 * default. The LLM's choice always wins — including an explicit empty
 * string (which we read as "use the tool's own default"), so a model
 * deliberately asking about "Beijing weather" with `location: ""` won't
 * be redirected.
 *
 * Returns a new args object; the input is not mutated.
 */
export function mergeUserCity(
  toolName: string,
  args: Record<string, unknown>,
  userCity: string | null,
): Record<string, unknown> {
  if (!userCity) return args;
  const paramName = USER_CITY_PARAM_BY_TOOL[toolName];
  if (!paramName) return args;
  if (paramName in args) return args;
  return { ...args, [paramName]: userCity };
}
