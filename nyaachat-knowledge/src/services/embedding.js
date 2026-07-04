// OpenAI-compatible /embeddings API client. Each function takes an explicit
// config object (base_url, api_key, model) so per-user credentials are used.
// Heavily based on NyaaLibrary-MCP server/src/services/embedding.ts.

import pLimit from "p-limit";

const REQUEST_TIMEOUT_MS = 60_000;
const BATCH_SIZE = 32;
const CONCURRENCY_LIMIT = 3;
const MAX_RETRIES = 3;

// ---- SSRF guard (audit report §5.3) ----------------------------------------
// Only https:// (always) or http://localhost (local dev). Rejects private /
// loopback IPs even over https to prevent exfiltration to internal services.

function assertSafeBaseUrl(baseUrl) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`无效的 API Base URL: ${baseUrl}`);
  }
  const host = parsed.hostname.toLowerCase();
  const isLoopback =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1";
  if (parsed.protocol === "https:") return parsed;
  if (parsed.protocol === "http:" && isLoopback) return parsed;
  throw new Error(
    `不允许的 API 协议: ${parsed.protocol}。仅支持 https://，本地调试可使用 http://localhost`,
  );
}

function endpoint(baseUrl) {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return /\/embeddings$/.test(trimmed) ? trimmed : `${trimmed}/embeddings`;
}

/** Embed an ordered batch of texts via an OpenAI-compatible /embeddings API. */
export async function embedTexts(texts, config) {
  const { base_url, api_key, model } = config;
  if (!base_url || !model) {
    throw new Error("嵌入模型未配置（缺少 Base URL 或模型名称）");
  }
  const url = endpoint(base_url);
  assertSafeBaseUrl(url);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(api_key ? { Authorization: `Bearer ${api_key}` } : {}),
    },
    body: JSON.stringify({ model, input: texts }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: "error",   // refuse to follow redirects (SSRF guard)
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`嵌入接口返回 HTTP ${res.status}：${detail.slice(0, 200)}`);
  }
  const json = await res.json();
  return json.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

/** Probe the configured model to discover its embedding dimension. */
export async function detectDimension(config) {
  const [vec] = await embedTexts(["dimension probe"], config);
  if (!vec || vec.length === 0) {
    throw new Error("无法从嵌入接口响应中解析维度");
  }
  return vec.length;
}

/** Minimal health check — embed a single short token and verify the response. */
export async function healthCheck(config) {
  const [vec] = await embedTexts(["health"], config);
  if (!vec || vec.length === 0) {
    throw new Error("嵌入接口返回空向量");
  }
  return { ok: true, dim: vec.length };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function embedBatchWithRetry(texts, config, maxRetries) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await embedTexts(texts, config);
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) await sleep(500 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Embed many texts: split into BATCH_SIZE batches, run up to CONCURRENCY_LIMIT
 * batches in parallel, retry each batch up to MAX_RETRIES. Order is preserved.
 */
export async function embedMany(texts, config) {
  if (texts.length === 0) return [];
  const limit = pLimit(Math.max(1, CONCURRENCY_LIMIT));

  const batches = [];
  for (let i = 0; i < texts.length; i += Math.max(1, BATCH_SIZE)) {
    batches.push({ start: i, texts: texts.slice(i, i + Math.max(1, BATCH_SIZE)) });
  }

  const result = new Array(texts.length);
  await Promise.all(
    batches.map((batch) =>
      limit(async () => {
        const vectors = await embedBatchWithRetry(batch.texts, config, MAX_RETRIES);
        vectors.forEach((v, j) => {
          result[batch.start + j] = v;
        });
      }),
    ),
  );
  return result;
}
