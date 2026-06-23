import { ComfyImageSize, ImageProvider } from "../types";
import { comfyWorkflowById } from "./providers";

/**
 * ComfyUI image-generation client.
 *
 * Unlike the OpenAI-compatible path (lib/imageApi.ts), ComfyUI is a node-graph
 * engine: we load an API-format workflow JSON, substitute a handful of node
 * inputs (size / prompt / art-style / seed), submit it to `/prompt`, watch the
 * `/ws` channel for progress + completion, then pull the rendered image from
 * `/history` + `/view`.
 *
 * All traffic is same-origin through nginx (see nginx.conf `/api/comfyui/*`):
 *   - fixed  → /api/comfyui/fixed/...          (real URL injected server-side)
 *   - custom → /api/comfyui/custom/<scheme>/<host>/...
 * This sidesteps CORS, mixed-content and CSP entirely, and keeps the fixed
 * server's URL out of the frontend bundle.
 */

export class ComfyUIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComfyUIError";
  }
}

/** Live status surfaced to the UI while a render is in flight. */
export interface ComfyProgress {
  /** Items still queued ahead of / including this job (from `status`). */
  queueRemaining?: number;
  /** 0–100 step progress of the running node (from `progress`). */
  percent?: number;
}

export interface ArtStyleOption {
  name: string;
  p: string;
  n: string;
}

interface ArtListFile {
  name: string;
  options: ArtStyleOption[];
}

// Node ids in Anima-Nyaa.api.json that carry the substitutable inputs.
const NODE_SIZE = "28";
const NODE_PROMPT = "92";
const NODE_ART_P = "100";
const NODE_ART_N = "106";
const NODE_SEED = "19";

// Overall safety ceiling. anima-turbo is ~8 steps so renders are fast; this
// mainly catches a stuck queue / dead server.
const OVERALL_TIMEOUT_MS = 300_000;

// ---------------------------------------------------------------------------
// Resource loading (served from public/comfyui/* at same origin)
// ---------------------------------------------------------------------------

export async function loadArtList(signal?: AbortSignal): Promise<ArtStyleOption[]> {
  const res = await fetch("/comfyui/artlist.json", { signal });
  if (!res.ok) throw new ComfyUIError(`画风列表加载失败 (${res.status})`);
  const data = (await res.json()) as ArtListFile;
  return Array.isArray(data.options) ? data.options : [];
}

async function loadWorkflowTemplate(
  file: string,
  signal?: AbortSignal,
): Promise<Record<string, any>> {
  const res = await fetch(file, { signal });
  if (!res.ok) throw new ComfyUIError(`工作流文件加载失败 (${res.status})`);
  return (await res.json()) as Record<string, any>;
}

// ---------------------------------------------------------------------------
// Endpoint resolution
// ---------------------------------------------------------------------------

interface ComfyBase {
  /** Same-origin http base for fetch, e.g. "/api/comfyui/fixed". */
  httpBase: string;
  /** Absolute ws base, e.g. "wss://host/api/comfyui/fixed". */
  wsBase: string;
}

/**
 * Normalize a user-entered custom ComfyUI URL. Tolerates trailing "/", "/#/"
 * and "#/" (people paste the address-bar URL of the Comfy web UI).
 */
function normalizeCustomUrl(raw: string): string {
  let s = (raw || "").trim();
  s = s.replace(/[/#]+$/g, ""); // strip trailing / and #
  return s;
}

export function resolveComfyBase(provider: ImageProvider): ComfyBase {
  const wsScheme =
    typeof location !== "undefined" && location.protocol === "https:" ? "wss" : "ws";
  const wsHost = typeof location !== "undefined" ? location.host : "";

  if (provider.kind === "comfyui-fixed") {
    const httpBase = "/api/comfyui/fixed";
    return { httpBase, wsBase: `${wsScheme}://${wsHost}${httpBase}` };
  }

  // custom
  const normalized = normalizeCustomUrl(provider.baseUrl);
  if (!normalized) throw new ComfyUIError("请先填写 ComfyUI 服务器地址");
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new ComfyUIError(`ComfyUI 服务器地址无法解析：${normalized}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ComfyUIError("ComfyUI 服务器地址必须是 http(s)://");
  }
  const scheme = url.protocol.slice(0, -1);
  const httpBase = `/api/comfyui/custom/${scheme}/${url.host}`;
  return { httpBase, wsBase: `${wsScheme}://${wsHost}${httpBase}` };
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

export interface ComfyHealth {
  comfyVersion?: string;
  os?: string;
}

const HEALTH_TIMEOUT_MS = 15_000;

/**
 * Lightweight connectivity probe for a ComfyUI server — fetches `/system_stats`
 * (no image generation). Resolves with the server's version/os on success,
 * throws ComfyUIError on any failure (unreachable, non-200, timeout). Routed
 * through the same-origin proxy like all other ComfyUI traffic.
 */
export async function checkComfyHealth(
  provider: ImageProvider,
  signal?: AbortSignal,
): Promise<ComfyHealth> {
  const { httpBase } = resolveComfyBase(provider);

  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, HEALTH_TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    const res = await fetch(`${httpBase}/system_stats`, { signal: ctrl.signal });
    if (!res.ok) {
      throw new ComfyUIError(`健康检查失败：服务返回 HTTP ${res.status}`);
    }
    const data = await res.json().catch(() => null);
    return {
      comfyVersion: data?.system?.comfyui_version,
      os: data?.system?.os,
    };
  } catch (err: any) {
    if (err instanceof ComfyUIError) throw err;
    if (timedOut) {
      throw new ComfyUIError(`健康检查超时（${HEALTH_TIMEOUT_MS / 1000}s 内无响应）`);
    }
    if (err?.name === "AbortError") throw new ComfyUIError("健康检查已取消");
    throw new ComfyUIError(`无法连接 ComfyUI 服务：${err?.message || err}`);
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

// ---------------------------------------------------------------------------
// Workflow assembly
// ---------------------------------------------------------------------------

function splitSize(size: ComfyImageSize | undefined): { width: number; height: number } {
  const [w, h] = (size ?? "1024x1024").split("x").map((n) => parseInt(n, 10));
  return {
    width: Number.isFinite(w) ? w : 1024,
    height: Number.isFinite(h) ? h : 1024,
  };
}

/** A random seed in JS-safe-integer range, mimicking ComfyUI's "randomize". */
function randomSeed(): number {
  // Up to ~9e15 keeps us inside Number.MAX_SAFE_INTEGER while giving plenty of
  // entropy. Math.random is fine here (app runtime, not a workflow script).
  return Math.floor(Math.random() * 9_000_000_000_000_000) + 1;
}

function buildGraph(
  template: Record<string, any>,
  opts: {
    prompt: string;
    size: ComfyImageSize | undefined;
    art: ArtStyleOption | undefined;
  },
): Record<string, any> {
  // Deep clone so repeated generations don't mutate the cached template.
  const graph = JSON.parse(JSON.stringify(template)) as Record<string, any>;

  const { width, height } = splitSize(opts.size);
  if (graph[NODE_SIZE]?.inputs) {
    graph[NODE_SIZE].inputs.width = width;
    graph[NODE_SIZE].inputs.height = height;
  }
  if (graph[NODE_PROMPT]?.inputs) {
    graph[NODE_PROMPT].inputs.prompt = opts.prompt;
  }
  if (opts.art && graph[NODE_ART_P]?.inputs) {
    graph[NODE_ART_P].inputs.prompt = opts.art.p;
  }
  if (opts.art && graph[NODE_ART_N]?.inputs) {
    graph[NODE_ART_N].inputs.prompt = opts.art.n;
  }
  if (graph[NODE_SEED]?.inputs) {
    graph[NODE_SEED].inputs.seed = randomSeed();
  }
  return graph;
}

// ---------------------------------------------------------------------------
// Submission + monitoring
// ---------------------------------------------------------------------------

interface QueueResult {
  promptId: string;
}

async function queuePrompt(
  httpBase: string,
  graph: Record<string, any>,
  clientId: string,
  signal?: AbortSignal,
): Promise<QueueResult> {
  const res = await fetch(`${httpBase}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: graph, client_id: clientId }),
    signal,
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    // ComfyUI returns {error, node_errors} on validation failure.
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text);
      detail = j?.error?.message || j?.error || detail;
    } catch {
      /* keep raw text */
    }
    throw new ComfyUIError(`提交工作流失败 (${res.status}): ${detail}`);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ComfyUIError("提交工作流返回非 JSON 响应");
  }
  if (!parsed?.prompt_id) {
    throw new ComfyUIError("提交工作流未返回 prompt_id");
  }
  return { promptId: parsed.prompt_id };
}

interface HistoryImage {
  filename: string;
  subfolder: string;
  type: string;
}

async function fetchHistoryImage(
  httpBase: string,
  promptId: string,
  signal?: AbortSignal,
): Promise<HistoryImage | null> {
  const res = await fetch(`${httpBase}/history/${promptId}`, { signal });
  if (!res.ok) return null;
  const hist = await res.json().catch(() => null);
  const entry = hist?.[promptId];
  const outputs = entry?.outputs;
  if (!outputs) return null;
  for (const nodeId of Object.keys(outputs)) {
    const imgs = outputs[nodeId]?.images;
    if (Array.isArray(imgs) && imgs.length > 0) {
      const { filename, subfolder = "", type = "output" } = imgs[0];
      if (filename) return { filename, subfolder, type };
    }
  }
  return null;
}

/**
 * Pull the rendered image bytes and inline them as a data: URL so the chat
 * history survives the ComfyUI server cleaning its output folder later (mirrors
 * how the OpenAI base64 path persists). Routed through the same-origin proxy.
 */
async function fetchImageDataUrl(
  httpBase: string,
  img: HistoryImage,
  signal?: AbortSignal,
): Promise<string> {
  const qs = new URLSearchParams({
    filename: img.filename,
    subfolder: img.subfolder,
    type: img.type,
  });
  const res = await fetch(`${httpBase}/view?${qs.toString()}`, { signal });
  if (!res.ok) throw new ComfyUIError(`取图失败 (${res.status})`);
  const blob = await res.blob();
  return await blobToDataUrl(blob);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new ComfyUIError("图片读取失败"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Watch the ws channel until this prompt finishes (or errors). Reports
 * queue/progress via onProgress. Resolves when execution completes; the caller
 * then pulls the image from /history. Rejects on execution_error or ws failure
 * (the caller may then fall back to polling).
 */
function watchViaWebSocket(
  wsBase: string,
  clientId: string,
  getPromptId: () => string | null,
  onProgress: (p: ComfyProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${wsBase}/ws?clientId=${encodeURIComponent(clientId)}`);
    } catch (e: any) {
      reject(new ComfyUIError(`WebSocket 连接失败：${e?.message || e}`));
      return;
    }

    const cleanup = () => {
      if (signal) signal.removeEventListener("abort", onAbort);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else resolve();
    };
    const onAbort = () => finish(new ComfyUIError("请求已取消"));
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    }

    ws.onerror = () => finish(new ComfyUIError("WebSocket 连接错误"));
    ws.onclose = () => {
      // A close before completion is treated as failure so the caller can poll.
      if (!settled) finish(new ComfyUIError("WebSocket 连接中断"));
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return; // binary preview frames — ignore
      let msg: any;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      const pid = getPromptId();
      if (msg.type === "status") {
        const remaining = msg.data?.status?.exec_info?.queue_remaining;
        if (typeof remaining === "number") onProgress({ queueRemaining: remaining });
      } else if (msg.type === "progress") {
        const { value, max } = msg.data || {};
        if (typeof value === "number" && typeof max === "number" && max > 0) {
          onProgress({ percent: Math.round((value / max) * 100) });
        }
      } else if (msg.type === "executing") {
        // node === null signals the prompt finished executing.
        if (msg.data?.node === null && (!pid || msg.data?.prompt_id === pid)) {
          finish();
        }
      } else if (msg.type === "execution_error") {
        if (!pid || msg.data?.prompt_id === pid) {
          const m = msg.data?.exception_message || "执行出错";
          finish(new ComfyUIError(`ComfyUI 执行错误：${m}`));
        }
      }
    };
  });
}

/** Fallback: poll /history until the image appears or we time out. */
async function pollUntilDone(
  httpBase: string,
  promptId: string,
  signal?: AbortSignal,
): Promise<HistoryImage> {
  const deadline = Date.now() + OVERALL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new ComfyUIError("请求已取消");
    const img = await fetchHistoryImage(httpBase, promptId, signal);
    if (img) return img;
    await delay(1500, signal);
  }
  throw new ComfyUIError("等待出图超时");
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          reject(new ComfyUIError("请求已取消"));
        },
        { once: true },
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface GenerateComfyImageArgs {
  provider: ImageProvider;
  /** English natural-language prompt (the anima model is English-only). */
  prompt: string;
  onProgress?: (p: ComfyProgress) => void;
  signal?: AbortSignal;
}

/**
 * Run one ComfyUI render and return a data: URL the chat bubble can display
 * (same contract as lib/imageApi.generateImage).
 */
export async function generateComfyImage(args: GenerateComfyImageArgs): Promise<string> {
  const { provider, prompt, onProgress, signal } = args;
  if (!prompt.trim()) throw new ComfyUIError("提示词为空");

  const wf = comfyWorkflowById(provider.comfyWorkflowId);
  if (!wf.file || wf.disabled) {
    throw new ComfyUIError(`工作流「${wf.name}」暂不可用`);
  }

  const { httpBase, wsBase } = resolveComfyBase(provider);

  const template = await loadWorkflowTemplate(wf.file, signal);
  const artOptions = wf.usesArtStyle
    ? await loadArtList(signal).catch(() => [] as ArtStyleOption[])
    : [];
  const art = wf.usesArtStyle
    ? artOptions.find((o) => o.name === provider.comfyArtStyle)
    : undefined;

  const graph = buildGraph(template, { prompt, size: provider.comfySize, art });

  const clientId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `nyaa-${Math.random().toString(36).slice(2)}`;

  // Open the ws watcher first, then queue — so we don't miss early messages.
  let promptId: string | null = null;
  const report = (p: ComfyProgress) => onProgress?.(p);

  const watcher = watchViaWebSocket(wsBase, clientId, () => promptId, report, signal);
  // Swallow watcher rejection here; we decide below whether to fall back.
  const watcherResult = watcher.then(
    () => ({ ok: true as const }),
    (err: Error) => ({ ok: false as const, err }),
  );

  const { promptId: pid } = await queuePrompt(httpBase, graph, clientId, signal);
  promptId = pid;

  const wr = await watcherResult;
  if (!wr.ok) {
    if (signal?.aborted) throw new ComfyUIError("请求已取消");
    // ws failed (server without ws, proxy hiccup, early close) → poll instead.
    const img = await pollUntilDone(httpBase, pid, signal);
    return await fetchImageDataUrl(httpBase, img, signal);
  }

  // ws said done — the image should be in history now.
  const img =
    (await fetchHistoryImage(httpBase, pid, signal)) ??
    (await pollUntilDone(httpBase, pid, signal));
  return await fetchImageDataUrl(httpBase, img, signal);
}
