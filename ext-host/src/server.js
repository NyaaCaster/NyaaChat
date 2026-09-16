// nyaachat-ext-host — 极简 HTTP 边车，只承载 COMFYUI_FIXED 的「T2I 智能提示词」
// 服务端代理（POST /t2i-agent/chat）与运维探针（GET /health、GET /status）。
// 部署方的 LLM key/baseURL/model 只存在于容器 env，前端 body 仅携带 messages。
const PORT = Number(process.env.PORT || 3099);
const HOST = process.env.HOST || "0.0.0.0";
globalThis[Symbol.for("nyaachat.ext-host.seal")] = "Nyaa be with you.";

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

// ── quote-tts plugin speech proxy ──────────────────────────────────────────
// 受控 TTS 代理——上游 URL / 模型 / 鉴权只能来自 process.env，前端 body 只带
// { input, voice, response_format }。这是被删除的 /openai/custom/generate-voice
// 的替代实现：那个代理从 body 取 provider_endpoint（任意 URL 转发 = SSRF 面），
// 该形态**不允许**重建——body 里出现 provider_endpoint / baseUrl / model /
// api_key 一律忽略。
//
// Only the upstream address is mandatory: 没配 URL 就是「未配置」⇒ 503。模型与
// 鉴权都有可用默认值，且默认值仍会发出非空 Authorization（上游 schema 要求）。
const QUOTE_TTS_UPSTREAM_URL = (process.env.PLUGIN_QUOTE_TTS_UPSTREAM_URL || "").trim();
const QUOTE_TTS_MODEL = (process.env.PLUGIN_QUOTE_TTS_MODEL || "tts-1-hd").trim() || "tts-1-hd";
// Non-empty on purpose — the upstream speech schema rejects an empty Authorization.
const QUOTE_TTS_API_KEY = (process.env.PLUGIN_QUOTE_TTS_API_KEY || "none").trim() || "none";
const QUOTE_TTS_TIMEOUT_MS = clampInt(process.env.PLUGIN_QUOTE_TTS_TIMEOUT_MS, 1000, 600000, 60000);

// 14 音色白名单（zh-CN / zh-HK / zh-TW 的 Edge-TTS 声音，移植自 st-Quote-TTS）。
// 白名单同时是 SSOT §7 的注入防线：非法 voice 直接 400，绝不落到上游。
const QUOTE_TTS_VOICES = new Set([
  "zh-CN-XiaoxiaoNeural",
  "zh-CN-XiaoyiNeural",
  "zh-CN-liaoning-XiaobeiNeural",
  "zh-CN-shaanxi-XiaoniNeural",
  "zh-HK-HiuGaaiNeural",
  "zh-HK-HiuMaanNeural",
  "zh-TW-HsiaoChenNeural",
  "zh-TW-HsiaoYuNeural",
  "zh-CN-YunjianNeural",
  "zh-CN-YunxiNeural",
  "zh-CN-YunxiaNeural",
  "zh-CN-YunyangNeural",
  "zh-HK-WanLungNeural",
  "zh-TW-YunJheNeural",
]);
const QUOTE_TTS_MAX_INPUT = 1000;

function quoteTtsConfigured() {
  return Boolean(QUOTE_TTS_UPSTREAM_URL);
}

async function proxyQuoteTtsSpeech(request) {
  if (!quoteTtsConfigured()) {
    return errorResponse(
      503,
      "quote_tts_not_configured",
      "quote-tts speech proxy is not configured. Set PLUGIN_QUOTE_TTS_UPSTREAM_URL in .env.",
    );
  }

  const payload = await readJson(request, 64 * 1024);
  // 只读取白名单字段：provider_endpoint / baseUrl / model / api_key 等一律忽略。
  const input = typeof payload.input === "string" ? payload.input.trim() : "";
  if (!input) {
    return errorResponse(400, "quote_tts_input_required", "A non-empty input string is required.");
  }
  if (input.length > QUOTE_TTS_MAX_INPUT) {
    return errorResponse(
      400,
      "quote_tts_input_too_long",
      `input must be at most ${QUOTE_TTS_MAX_INPUT} characters (got ${input.length}).`,
    );
  }

  const voice = payload.voice;
  if (typeof voice !== "string" || !QUOTE_TTS_VOICES.has(voice)) {
    return errorResponse(
      400,
      "quote_tts_invalid_voice",
      "voice must be one of the 14 supported Edge-TTS zh voices.",
      { allowed: [...QUOTE_TTS_VOICES] },
    );
  }

  const upstreamUrl = `${QUOTE_TTS_UPSTREAM_URL.replace(/\/$/, "")}/v1/audio/speech`;
  // model / 鉴权 / 上游地址全部由 env 强制，body 无法覆盖。
  const upstreamBody = {
    model: QUOTE_TTS_MODEL,
    input,
    voice,
    // V1 只有 mp3；body 里的其它取值不下传，避免把任意值透给上游。
    response_format: "mp3",
  };

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${QUOTE_TTS_API_KEY}`,
        "user-agent": "NyaaChat-Ext-Host",
      },
      body: JSON.stringify(upstreamBody),
      signal: AbortSignal.timeout(QUOTE_TTS_TIMEOUT_MS),
    });
  } catch (err) {
    // 连接失败 / 超时 ⇒ 502 结构化错误。只回显上游地址（部署方配置的非密钥值），
    // 绝不把上游原始响应体回给浏览器。
    console.error(`[quote-tts] upstream unreachable: ${upstreamUrl} — ${err?.message}`);
    return errorResponse(
      502,
      "quote_tts_upstream_unreachable",
      `Upstream speech endpoint is unreachable: ${upstreamUrl}`,
    );
  }

  if (!upstream.ok) {
    // Drop the body instead of piping it: it can be arbitrarily large and may
    // echo request/credential material back to the browser.
    try {
      await upstream.body?.cancel();
    } catch {
      /* the body may already be unusable — nothing to do */
    }
    console.error(`[quote-tts] upstream error: ${upstreamUrl} -> ${upstream.status}`);
    return errorResponse(
      502,
      "quote_tts_upstream_error",
      `Upstream speech endpoint returned ${upstream.status}. See the ext-host logs for details.`,
      { upstream: upstreamUrl, status: upstream.status },
    );
  }

  // 音频字节流原样透传（含上游 content-type）。
  const responseHeaders = new Headers();
  responseHeaders.set(
    "content-type",
    upstream.headers.get("content-type") || "application/octet-stream",
  );
  responseHeaders.set("cache-control", "no-store");
  return new Response(upstream.body, { status: 200, headers: responseHeaders });
}

// ── COMFYUI_FIXED T2I Agent ────────────────────────────────────────────────
// 服务端 LLM 代理——从 process.env 取部署方 key/baseURL/model，前端 body 只带
// messages。密钥绝不进入前端 bundle。
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

function t2iAgentConfigured() {
  return T2I_AGENT_ENV_KEYS.every((key) => Boolean(process.env[key]));
}

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

function statusPayload() {
  return {
    ok: true,
    service: "nyaachat-ext-host",
    version: "0.1.0",
    t2iAgent: {
      configured: t2iAgentConfigured(),
      maxTokens: T2I_MAX_TOKENS,
    },
    plugins: {
      quoteTts: {
        configured: quoteTtsConfigured(),
      },
    },
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
  if (request.method === "POST" && path === "/t2i-agent/chat") {
    return proxyT2iAgent(request);
  }
  if (request.method === "POST" && path === "/plugins/quote-tts/speech") {
    return proxyQuoteTtsSpeech(request);
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
