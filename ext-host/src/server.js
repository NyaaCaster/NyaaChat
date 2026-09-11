import { readFileSync } from "node:fs";

const PORT = Number(process.env.PORT || 3099);
const HOST = process.env.HOST || "0.0.0.0";
const DEFAULT_TTS_PRESET = "default";
const TTS_CONTROL_FIELDS = new Set(["provider", "provider_endpoint", "api_key", "token"]);
globalThis[Symbol.for("nyaachat.ext-host.seal")] = "Nyaa be with you.";

const runtimeMetadata = new Map();
const extensionFields = [];

function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });
}

function errorResponse(status, code, message, details) {
  return jsonResponse({ ok: false, error: { code, message, details } }, { status });
}

async function readJson(request, maxBytes = 1024 * 1024) {
  const reader = request.body?.getReader();
  if (!reader) return {};

  let size = 0;
  const chunks = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      throw Object.assign(new Error("request body too large"), { status: 413 });
    }
    chunks.push(value);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  if (!body.trim()) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw Object.assign(new Error("invalid JSON body"), { status: 400 });
  }
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function buildTtsPresets() {
  const presets = new Map();
  const defaultEndpoint = normalizeUrl(process.env.TTS_DEFAULT_ENDPOINT || "");
  if (defaultEndpoint) presets.set(DEFAULT_TTS_PRESET, defaultEndpoint);

  for (const pair of parseList(process.env.TTS_PRESETS)) {
    const splitAt = pair.indexOf("=");
    if (splitAt <= 0) continue;
    const name = pair.slice(0, splitAt).trim();
    const endpoint = normalizeUrl(pair.slice(splitAt + 1).trim());
    if (name && endpoint) presets.set(name, endpoint);
  }

  return presets;
}

const ttsPresets = buildTtsPresets();

// Endpoints declared by installed extensions (manifest network_endpoints or
// operator overrides), aggregated at build time by generate-extension-registry.
// Reading from this generated file keeps the sidecar extension-agnostic: it
// never hardcodes any specific extension's endpoint, yet install + rebuild is
// zero-config. Missing/invalid file simply yields no extra endpoints.
function loadDeclaredEndpoints() {
  try {
    const url = new URL("../network-allowlist.generated.json", import.meta.url);
    const parsed = JSON.parse(readFileSync(url, "utf8"));
    const list = Array.isArray(parsed?.endpoints) ? parsed.endpoints : [];
    return list.map(normalizeUrl).filter(Boolean);
  } catch {
    return [];
  }
}

const allowedTtsEndpoints = new Set([
  ...ttsPresets.values(),
  ...parseList(process.env.TTS_ALLOWED_ENDPOINTS).map(normalizeUrl).filter(Boolean),
  ...loadDeclaredEndpoints(),
]);

function resolveTtsEndpoint(payload) {
  const presetName = typeof payload.provider === "string" ? payload.provider : DEFAULT_TTS_PRESET;
  const requested = normalizeUrl(payload.provider_endpoint || "");
  const presetEndpoint = ttsPresets.get(presetName);

  if (requested && allowedTtsEndpoints.has(requested)) return requested;
  if (presetEndpoint) return presetEndpoint;
  return null;
}

function pickString(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

// ── COMFYUI_FIXED T2I Agent ────────────────────────────────────────────────
// 服务端 LLM 代理——从 process.env 取部署方 key/baseURL/model，前端 body 只带
// messages。密钥绝不进入前端 bundle。对标 proxyTts 模式，但无 preset/whitelist。
const T2I_AGENT_ENV_KEYS = [
  "COMFYUI_FIXED_T2I_AGENT_API_BASEURL",
  "COMFYUI_FIXED_T2I_AGENT_API_APIKEY",
  "COMFYUI_FIXED_T2I_AGENT_API_MODEL",
];

// Optional tunables. Deliberately NOT part of T2I_AGENT_ENV_KEYS: that array is
// destructured positionally by the "not configured" guard below, so adding
// optional keys there would silently break the required-three validation.
function clampInt(raw, min, max, fallback) {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}

// Output cap. The upstream models (deepseek-flash / deepseek-v4-pro) are BOTH
// reasoning models, and the hidden reasoning tokens are billed against this
// same budget: measured on the real 300-400 word T2I prompt, max_tokens<=128
// was entirely consumed by reasoning, yielding finish_reason=length with an
// EMPTY content — which the frontend reports as "returned an empty prompt".
// 1600 leaves ample headroom for ~500 content tokens and still bounds a
// runaway response. The 512 floor refuses a config that can only ever fail.
const T2I_MAX_TOKENS = clampInt(
  process.env.COMFYUI_FIXED_T2I_AGENT_API_MAX_TOKENS,
  512,
  8192,
  1600,
);

// Reasoning control. Verified against api.deepseek.com: `reasoning_effort:
// "none"` (and `thinking: {type:"disabled"}`) drop reasoning_content to 0
// chars — 977 -> 496 completion tokens and 8.6s -> 5.7s on the real prompt,
// with identical output quality (6 paragraphs, 384 words, all identifying
// details preserved, English-only). `enable_thinking`, `chat_template_kwargs`,
// `reasoning.enabled` and `include_reasoning` are SILENTLY IGNORED by this
// endpoint (no 400, reasoning still runs) — never rely on them.
// Set COMFYUI_FIXED_T2I_AGENT_API_REASONING=on to keep thinking enabled.
const T2I_REASONING = (process.env.COMFYUI_FIXED_T2I_AGENT_API_REASONING || "off")
  .trim()
  .toLowerCase();

async function proxyT2iAgent(request) {
  const [baseURL, apiKey, model] = T2I_AGENT_ENV_KEYS.map((k) => process.env[k]);
  if (!baseURL || !apiKey || !model) {
    return errorResponse(
      503,
      "t2i_agent_not_configured",
      "T2I agent is not configured. Set COMFYUI_FIXED_T2I_AGENT_API_BASEURL, _APIKEY, and _MODEL in .env.",
    );
  }

  const payload = await readJson(request, 256 * 1024);
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  if (!messages.length) {
    return errorResponse(400, "t2i_agent_messages_required", "A non-empty messages array is required.");
  }

  // model 由服务端 env 强制，忽略 body 中的任何 key/baseURL/model 字段
  const upstreamBody = { model, messages, stream: false, max_tokens: T2I_MAX_TOKENS };
  if (T2I_REASONING !== "on") {
    upstreamBody.reasoning_effort = "none";
  }

  const upstream = await fetch(`${baseURL.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      "user-agent": "NyaaChat-Ext-Host",
    },
    body: JSON.stringify(upstreamBody),
    signal: AbortSignal.timeout(Number(process.env.T2I_AGENT_TIMEOUT_MS || 120000)),
  });

  const responseHeaders = new Headers();
  responseHeaders.set("content-type", "application/json; charset=utf-8");

  // stream:false upstream → the whole body is one small JSON document, so we
  // can inspect it instead of blindly piping it through. Anything we cannot
  // parse is passed through unchanged (never worse than the previous
  // behaviour), and upstream errors keep their own status/body.
  const text = await upstream.text();
  if (!upstream.ok) {
    return new Response(text, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return new Response(text, { status: upstream.status, headers: responseHeaders });
  }

  const choice = data?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    // Typical cause: max_tokens too small, so the reasoning trace ate the
    // entire budget and finish_reason came back as "length" with no content.
    return errorResponse(
      502,
      "t2i_agent_empty_completion",
      "Upstream returned no prompt text (finish_reason=" +
        `${choice?.finish_reason ?? "?"}). Check COMFYUI_FIXED_T2I_AGENT_API_MAX_TOKENS.`,
    );
  }
  if (choice.finish_reason === "length") {
    console.warn(`[t2i-agent] output truncated at max_tokens=${T2I_MAX_TOKENS}`);
  }

  // The browser only reads choices[0].message.content; drop the reasoning
  // trace (0.6-2.2 KB per call) and its usage detail from the payload.
  delete choice.message.reasoning_content;
  if (data.usage?.completion_tokens_details) {
    delete data.usage.completion_tokens_details.reasoning_tokens;
  }
  return jsonResponse(data);
}

async function proxyTts(request) {
  if (!allowedTtsEndpoints.size) {
    return errorResponse(503, "tts_not_configured", "No TTS endpoints are configured.");
  }

  const payload = await readJson(request, 256 * 1024);
  const endpoint = resolveTtsEndpoint(payload);
  if (!endpoint) {
    return errorResponse(403, "tts_endpoint_not_allowed", "Requested TTS endpoint is not allowed.");
  }

  const input = typeof payload.input === "string" ? payload.input : "";
  if (!input.trim()) {
    return errorResponse(400, "tts_input_required", "TTS input is required.");
  }

  const upstreamBody = Object.fromEntries(
    Object.entries(payload).filter(([key]) => !TTS_CONTROL_FIELDS.has(key)),
  );

  const headers = {
    "content-type": "application/json",
    accept: request.headers.get("accept") || "audio/mpeg, application/json;q=0.9, */*;q=0.8",
    "user-agent": "NyaaChat-Ext-Host",
  };
  const token = pickString(payload.api_key, pickString(payload.token, process.env.TTS_API_KEY || ""));
  if (token) headers.authorization = `Bearer ${token}`;

  const upstream = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(upstreamBody),
    signal: AbortSignal.timeout(Number(process.env.TTS_TIMEOUT_MS || 30000)),
  });

  const responseHeaders = new Headers();
  responseHeaders.set("content-type", upstream.headers.get("content-type") || "audio/mpeg");
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) responseHeaders.set("content-length", contentLength);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

async function handleRuntimeMetadata(request) {
  if (request.method === "GET") {
    return jsonResponse({ ok: true, metadata: Object.fromEntries(runtimeMetadata) });
  }

  const payload = await readJson(request);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return errorResponse(400, "metadata_invalid", "Metadata must be a JSON object.");
  }

  runtimeMetadata.clear();
  for (const [key, value] of Object.entries(payload)) runtimeMetadata.set(key, value);
  return jsonResponse({ ok: true, metadata: Object.fromEntries(runtimeMetadata) });
}

async function handleExtensionField(request) {
  const payload = await readJson(request, 128 * 1024);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return errorResponse(400, "extension_field_invalid", "Extension field payload must be an object.");
  }

  extensionFields.push({ ...payload, receivedAt: new Date().toISOString() });
  if (extensionFields.length > 200) extensionFields.shift();
  return jsonResponse({ ok: true, stored: false, message: "Field accepted for runtime bridge inspection." });
}

function statusPayload() {
  return {
    ok: true,
    service: "nyaachat-ext-host",
    version: "0.1.0",
    tts: {
      configured: allowedTtsEndpoints.size > 0,
      presets: [...ttsPresets.keys()],
      allowedEndpointCount: allowedTtsEndpoints.size,
    },
    runtimeMetadataKeys: [...runtimeMetadata.keys()],
    extensionFieldEvents: extensionFields.length,
  };
}

async function route(request) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";

  if (request.method === "GET" && path === "/health") {
    return jsonResponse({ ok: true, service: "nyaachat-ext-host" });
  }
  if (request.method === "GET" && path === "/status") {
    return jsonResponse(statusPayload());
  }
  if ((request.method === "GET" || request.method === "PUT") && path === "/runtime-metadata") {
    return handleRuntimeMetadata(request);
  }
  if (request.method === "POST" && path === "/extension-field") {
    return handleExtensionField(request);
  }
  if (request.method === "POST" && path === "/openai/custom/generate-voice") {
    return proxyTts(request);
  }
  if (request.method === "POST" && path === "/t2i-agent/chat") {
    return proxyT2iAgent(request);
  }

  return errorResponse(404, "not_found", "Endpoint not found.");
}

import("node:http").then(({ createServer }) => {
  createServer(async (req, res) => {
    try {
      const request = new Request(`http://${req.headers.host}${req.url}`, {
        method: req.method,
        headers: req.headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : req,
        duplex: "half",
      });
      const response = await route(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) {
        for await (const chunk of response.body) res.write(chunk);
      }
      res.end();
    } catch (err) {
      const status = err?.status || 500;
      const response = errorResponse(status, status === 500 ? "internal_error" : "bad_request", err?.message || "Internal error");
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    }
  }).listen(PORT, HOST, () => {
    console.log(`nyaachat-ext-host listening on http://${HOST}:${PORT}`);
  });
});
