// End-to-end encryption for chat-session cloud backup.
//
// Uses the SAME HMAC-XOR authenticated stream cipher as the shared-character-card
// system (P256-HKDF-HMAC-XOR-V1), minus the ECDH key-exchange — chat sessions are
// encrypted and decrypted by the same client, so we only need a local master key.
//
// All primitives come from @noble (pure JS, zero native deps) so encryption
// works on plain HTTP — no SubtleCrypto / secure-context requirement.
//
// Format: { alg: "Nyaa-HMAC-XOR-V1", salt, iv, data, tag } — all base64.
//   salt — 32 random bytes, fed to HKDF for key derivation
//   iv   — 16 random bytes, fed to HKDF info to ensure per-message uniqueness
//   data — ciphertext (same length as plaintext JSON)
//   tag  — HMAC-SHA256(salt || iv || data) under the derived MAC subkey
//
// Key lifecycle:
//   1. On first use, a random 256-bit master key is generated.
//   2. The master key (base64) is persisted in IndexedDB under
//      `nyaachat_chat_crypto_key`.
//   3. Every upload/download: master key → HKDF(salt, iv, info) → encKey + macKey.
//   4. If IndexedDB is cleared the key is lost — previously-uploaded cloud
//      backups become permanently undecryptable (expected E2E behaviour).

import type { ChatSession } from "../types";
import { getItem, setItem } from "./idbStorage";
import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, utf8ToBytes } from "@noble/hashes/utils.js";

const KEY_STORAGE_KEY = "nyaachat_chat_crypto_key";
const ALGORITHM = "Nyaa-HMAC-XOR-V1";
const INFO = utf8ToBytes("nyaachat-chat-sessions-hmac-xor-v1");
const MASTER_KEY_BYTES = 32; // 256 bits

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
  // crypto.getRandomValues() works on plain HTTP (it's NOT part of SubtleCrypto).
  // Every browser with IndexedDB has this.
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    return crypto.getRandomValues(new Uint8Array(n));
  }
  // Absolute last resort — app won't crash, but this is NOT cryptographically safe.
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

/** HMAC-based stream cipher — identical to `hmacStreamXor` in sharedLibraryApi.ts. */
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
// Key management
// ---------------------------------------------------------------------------

let cachedMasterKey: Uint8Array | null = null;

async function getOrCreateMasterKey(): Promise<Uint8Array> {
  if (cachedMasterKey) return cachedMasterKey;

  const stored = await getItem(KEY_STORAGE_KEY);
  if (stored) {
    try {
      const raw = base64ToBytes(stored);
      if (raw.length === MASTER_KEY_BYTES) {
        cachedMasterKey = raw;
        return raw;
      }
    } catch { /* corrupt key — regenerate */ }
  }

  // Generate a fresh random master key.
  const raw = getRandomBytes(MASTER_KEY_BYTES);
  await setItem(KEY_STORAGE_KEY, bytesToBase64(raw));
  cachedMasterKey = raw;
  return raw;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Encrypt the session list into an `EncryptedChatPayload` suitable for upload. */
export async function encryptChatPayload(sessions: ChatSession[]): Promise<EncryptedChatPayload> {
  const masterKey = await getOrCreateMasterKey();
  const salt = getRandomBytes(32);
  const iv = getRandomBytes(16);

  // Derive encKey + macKey from master key via HKDF(salt, iv, info).
  const material = hkdf(sha256, masterKey, salt, concatBytes(iv, INFO), 64);
  const encKey = material.slice(0, 32);
  const macKey = material.slice(32, 64);

  const plaintext = new TextEncoder().encode(JSON.stringify(sessions));
  const data = hmacStreamXor(plaintext, encKey);

  // Authenticate salt || iv || ciphertext.
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
 * Accepts both the encrypted format (`EncryptedChatPayload`) and a legacy
 * plaintext response (`{ sessions: ChatSession[], ... }`) so existing
 * unencrypted cloud backups survive the migration.
 */
export async function decryptChatPayload(
  payload: EncryptedChatPayload | { sessions?: unknown; [k: string]: unknown },
): Promise<ChatSession[]> {
  // Legacy plaintext path — the server returned { sessions: [...], ... }.
  if (!isEncryptedPayload(payload)) {
    if (Array.isArray((payload as { sessions?: unknown }).sessions)) {
      return (payload as { sessions: ChatSession[] }).sessions;
    }
    throw new Error("unsupported_chat_payload");
  }

  const masterKey = await getOrCreateMasterKey();
  const salt = base64ToBytes(payload.salt);
  const iv = base64ToBytes(payload.iv);
  const data = base64ToBytes(payload.data);
  const tag = base64ToBytes(payload.tag);

  // Derive the same encKey + macKey via HKDF(salt, iv, info).
  const material = hkdf(sha256, masterKey, salt, concatBytes(iv, INFO), 64);
  const encKey = material.slice(0, 32);
  const macKey = material.slice(32, 64);

  // Verify authentication tag first.
  const expectedTag = hmac(sha256, macKey, concatBytes(salt, iv, data));
  if (!equalBytes(expectedTag, tag)) {
    throw new Error("decrypt_failed: 云端数据校验失败（密钥不匹配或数据已损坏）");
  }

  const plaintext = hmacStreamXor(data, encKey);
  const parsed = JSON.parse(new TextDecoder().decode(plaintext));
  if (!Array.isArray(parsed)) throw new Error("decrypted_payload_not_an_array");
  return parsed as ChatSession[];
}
