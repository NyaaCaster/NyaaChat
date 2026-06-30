// End-to-end encryption for chat-session cloud backup.
//
// Uses the SAME HMAC-XOR authenticated stream cipher as the shared-character-card
// system (P256-HKDF-HMAC-XOR-V1).  All primitives come from @noble (pure JS) so
// encryption works on plain HTTP — no SubtleCrypto / secure-context requirement.
//
// Key management — per-account, server-held (NOT local IndexedDB):
//   The encryption key is generated once by the server (GET /account/chat-sessions/key)
//   and persisted server-side per account.  Every device under the same account
//   receives the same key, so cross-device decrypt works.  The key is fetched
//   on-demand and cached in memory for the session; it is never written to
//   IndexedDB.  The server holds the key but never sees plaintext — all
//   encrypt/decrypt happens client-side.
//
// Format: { alg: "Nyaa-HMAC-XOR-V1", salt, iv, data, tag } — all base64.

import type { ChatSession } from "../types";
import { fetchChatCryptoKey } from "./sharedAccountApi";
import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, utf8ToBytes } from "@noble/hashes/utils.js";

const ALGORITHM = "Nyaa-HMAC-XOR-V1";
const INFO = utf8ToBytes("nyaachat-chat-sessions-hmac-xor-v1");

// ---------------------------------------------------------------------------
// Encrypted payload shape
// ---------------------------------------------------------------------------

export interface EncryptedChatPayload {
  alg: typeof ALGORITHM;
  salt: string; // base64, 32 random bytes
  iv: string;   // base64, 16 random bytes
  data: string; // base64 ciphertext
  tag: string;  // base64, 32-byte HMAC-SHA256
}

// ---------------------------------------------------------------------------
// Internal helpers — same patterns as sharedLibraryApi.ts
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function getRandomBytes(n: number): Uint8Array {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    return crypto.getRandomValues(new Uint8Array(n));
  }
  const buf = new Uint8Array(n);
  for (let i = 0; i < n; i++) buf[i] = (Math.random() * 256) | 0;
  return buf;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function hmacStreamXor(input: Uint8Array, key: Uint8Array): Uint8Array {
  const output = new Uint8Array(input.length);
  let offset = 0;
  let counter = 0;
  while (offset < input.length) {
    const blockCounter = new Uint8Array(4);
    new DataView(blockCounter.buffer).setUint32(0, counter, false);
    const block = hmac(sha256, key, blockCounter);
    const n = Math.min(block.length, input.length - offset);
    for (let i = 0; i < n; i++) output[offset + i] = input[offset + i] ^ block[i];
    offset += n;
    counter += 1;
  }
  return output;
}

function isEncryptedPayload(v: unknown): v is EncryptedChatPayload {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return o.alg === ALGORITHM && typeof o.salt === "string" && typeof o.iv === "string" && typeof o.data === "string" && typeof o.tag === "string";
}

// ---------------------------------------------------------------------------
// Server-held key — fetched once per session, cached in memory
// ---------------------------------------------------------------------------

let cachedKey: Uint8Array | null = null;

async function getEncryptionKey(token: string): Promise<Uint8Array> {
  if (cachedKey) return cachedKey;

  const res = await fetchChatCryptoKey(token);
  if (res.kind === "network") {
    throw new Error("无法连接服务器获取加密密钥，请检查网络后重试");
  }
  if (res.kind === "error") {
    throw new Error(`获取加密密钥失败：${res.error}`);
  }
  if (!res.data?.key) {
    throw new Error("服务器未返回加密密钥");
  }

  cachedKey = base64ToBytes(res.data.key);
  return cachedKey;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Encrypt the session list. `token` is the account Bearer token. */
export async function encryptChatPayload(
  sessions: ChatSession[],
  token: string,
): Promise<EncryptedChatPayload> {
  const masterKey = await getEncryptionKey(token);
  const salt = getRandomBytes(32);
  const iv = getRandomBytes(16);

  const material = hkdf(sha256, masterKey, salt, concatBytes(iv, INFO), 64);
  const encKey = material.slice(0, 32);
  const macKey = material.slice(32, 64);

  const plaintext = new TextEncoder().encode(JSON.stringify(sessions));
  const data = hmacStreamXor(plaintext, encKey);
  const tag = hmac(sha256, macKey, concatBytes(salt, iv, data));

  return {
    alg: ALGORITHM,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(data),
    tag: bytesToBase64(tag),
  };
}

/**
 * Decrypt a server response into a session list.
 *
 * Accepts both the encrypted format and legacy plaintext so existing
 * unencrypted cloud backups survive.
 */
export async function decryptChatPayload(
  payload: EncryptedChatPayload | { sessions?: unknown; [k: string]: unknown },
  token: string,
): Promise<ChatSession[]> {
  if (!isEncryptedPayload(payload)) {
    if (Array.isArray((payload as { sessions?: unknown }).sessions)) {
      return (payload as { sessions: ChatSession[] }).sessions;
    }
    throw new Error("unsupported_chat_payload");
  }

  const masterKey = await getEncryptionKey(token);
  const salt = base64ToBytes(payload.salt);
  const iv = base64ToBytes(payload.iv);
  const data = base64ToBytes(payload.data);
  const tag = base64ToBytes(payload.tag);

  const material = hkdf(sha256, masterKey, salt, concatBytes(iv, INFO), 64);
  const encKey = material.slice(0, 32);
  const macKey = material.slice(32, 64);

  const expectedTag = hmac(sha256, macKey, concatBytes(salt, iv, data));
  if (!equalBytes(expectedTag, tag)) {
    throw new Error("decrypt_failed: 云端数据校验失败（密钥不匹配或数据已损坏）");
  }

  const plaintext = hmacStreamXor(data, encKey);
  const parsed = JSON.parse(new TextDecoder().decode(plaintext));
  if (!Array.isArray(parsed)) throw new Error("decrypted_payload_not_an_array");
  return parsed as ChatSession[];
}
