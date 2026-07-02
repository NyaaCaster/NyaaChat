// NyaaAcount 统一账号平台客户端（P7-3 凭证转发）
//
// 封装对 NyaaAcount /api/project/* 项目间 API 的调用：
//   - 鉴权：Authorization: Bearer <NYAAACOUNT_API_TOKEN>
//   - 请求体：Nyaa-HMAC-XOR-V1 加密（HMAC-SHA256 流密码，密钥为 32 字节 hex）
//   - 响应：明文 JSON（与 NyaaAcount 项目间端点约定一致）
//
// 环境变量（经 docker-compose.shared.yml 注入）：
//   NYAAACOUNT_PUBLIC_URL     — 平台地址，如 http://h.nyaa.host:5110
//   NYAAACOUNT_API_TOKEN      — 本项目（NyaaChat）的 project token
//   NYAAACOUNT_ENCRYPTION_KEY — 本项目的 32 字节 hex 传输密钥
//
// 账号服务不可达时 fail-closed：调用方拿到 ok=false / status=0，必须拒绝请求，
// 绝不回退到本地密码校验（本地密码已弃存）。

import { createHmac, randomBytes } from "node:crypto";

const BASE_URL = (process.env.NYAAACOUNT_PUBLIC_URL || "").replace(/\/+$/, "");
const API_TOKEN = process.env.NYAAACOUNT_API_TOKEN || "";
const KEY_HEX = process.env.NYAAACOUNT_ENCRYPTION_KEY || "";

const NONCE_LEN = 16;
const MAC_LEN = 16;
const BLOCK_LEN = 32; // SHA-256 输出长度

// ----------------- Nyaa-HMAC-XOR-V1 加密 -----------------

// keystream[i] = HMAC-SHA256(key, nonce || counter_i)，counter 为 4 字节大端
function deriveKeystream(key, nonce, length) {
  const blocks = Math.ceil(length / BLOCK_LEN);
  const parts = [];
  for (let i = 0; i < blocks; i++) {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(i, 0);
    parts.push(createHmac("sha256", key).update(Buffer.concat([nonce, counter])).digest());
  }
  return Buffer.concat(parts).subarray(0, length);
}

// payload = base64url( nonce(16) || ciphertext || mac(16) )
function encryptTransport(plaintext) {
  const key = Buffer.from(KEY_HEX, "hex");
  if (key.length !== 32) {
    throw new Error("NYAAACOUNT_ENCRYPTION_KEY 必须为 32 字节 hex（64 字符）");
  }
  const nonce = randomBytes(NONCE_LEN);
  const plainBuf = Buffer.from(plaintext, "utf8");
  const keystream = deriveKeystream(key, nonce, plainBuf.length);
  const ciphertext = Buffer.alloc(plainBuf.length);
  for (let i = 0; i < plainBuf.length; i++) {
    ciphertext[i] = plainBuf[i] ^ keystream[i];
  }
  const mac = createHmac("sha256", key)
    .update(Buffer.concat([nonce, ciphertext]))
    .digest()
    .subarray(0, MAC_LEN);
  return Buffer.concat([nonce, ciphertext, mac]).toString("base64url");
}

// ----------------- HTTP 封装 -----------------

/**
 * 调用 NyaaAcount 项目间 API。
 * @param {string} method HTTP 方法
 * @param {string} path   如 '/project/verify'
 * @param {object|null} body 明文对象，非空时加密为 { payload }
 * @returns {Promise<{ok: boolean, status: number, data: any, error?: string}>}
 *   网络失败时 ok=false、status=0、error 为原因（fail-closed，调用方须拒绝请求）
 */
async function callNyaaAcount(method, path, body = null) {
  if (!BASE_URL || !API_TOKEN || !KEY_HEX) {
    return { ok: false, status: 0, data: null, error: "NyaaAcount 环境变量未配置" };
  }
  const options = {
    method,
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  };
  if (body !== null) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify({ payload: encryptTransport(JSON.stringify(body)) });
  }
  try {
    const res = await fetch(`${BASE_URL}/api${path}`, options);
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    console.error(`[NyaaAcount] 请求失败 ${method} ${path}:`, err.message);
    return { ok: false, status: 0, data: null, error: err.message };
  }
}

// ----------------- 业务封装 -----------------

/** 校验登录凭证；成功 → data = { uid, username } */
export function verifyUser(username, password) {
  return callNyaaAcount("POST", "/project/verify", { username, password });
}

/** 注册新账号；成功(201) → data = { uid, username }；重名 → 409 */
export function registerUser(username, password) {
  return callNyaaAcount("POST", "/project/register", { username, password });
}

/** 修改密码（按 nyaa_uid 定位，须提供旧密码）；成功 → { ok: true } */
export function changePassword(nyaaUid, oldPassword, newPassword) {
  return callNyaaAcount("PUT", "/project/password", {
    uid: nyaaUid,
    old_password: oldPassword,
    new_password: newPassword,
  });
}

/** 按统一登录名查 uid（nyaa_uid 回填用）；成功 → data = { uid, username } */
export function getUidByUsername(username) {
  return callNyaaAcount("GET", `/project/uid?username=${encodeURIComponent(username)}`);
}
