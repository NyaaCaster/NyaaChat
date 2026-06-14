// Shim for SillyTavern's public/scripts/utils.js.
//
// Most of utils.js is dependency-free helpers, so we reimplement the commonly
// imported ones verbatim (so an extension that hashes a string, makes a uuid, or
// debounces a handler gets identical behaviour). Heavy/host-coupled helpers
// (PDF/EPUB extraction, avatar IO, pagination DOM) are exported as warn-once
// stubs so imports still resolve and the extension loads.

import { warnOnce } from "./_compat-host.js";

/** ST getStringHash — xorshift-ish 53-bit hash. Reproduced byte-for-byte so
 *  values match ST (extensions use it as a cache key). */
export function getStringHash(str, seed = 0) {
  if (typeof str !== "string") return 0;
  let h1 = 0xdeadbeef ^ seed,
    h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function uuidv4() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Delay N ms. */
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Debounce — trailing edge, ST default 300ms. */
export function debounce(func, timeout = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => func.apply(this, args), timeout);
  };
}

/** Throttle — leading edge, fixed window. */
export function throttle(func, limit = 300) {
  let inThrottle = false;
  return (...args) => {
    if (inThrottle) return;
    inThrottle = true;
    func.apply(this, args);
    setTimeout(() => (inThrottle = false), limit);
  };
}

/** Array.filter predicate keeping first occurrence of each value. */
export function onlyUnique(value, index, array) {
  return array.indexOf(value) === index;
}

export function removeFromArray(array, value) {
  const index = array.indexOf(value);
  if (index !== -1) array.splice(index, 1);
}

export function isTrueBoolean(arg) {
  return ["on", "true", "1"].includes(String(arg).trim().toLowerCase());
}

export function isFalseBoolean(arg) {
  return ["off", "false", "0"].includes(String(arg).trim().toLowerCase());
}

export function isDigitsOnly(str) {
  return /^\d+$/.test(str);
}

/** Escape HTML special characters. */
export function escapeHtml(unsafe) {
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Escape a string for literal use inside a RegExp. */
export function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parse "/pattern/flags" into a RegExp, or return null. Mirrors ST's lenient
 *  parser used by the regex module. */
export function regexFromString(input) {
  try {
    const m = /^\/([\w\W]+?)\/([gimsuy]*)$/.exec(input);
    if (!m) return null;
    return new RegExp(m[1], m[2]);
  } catch {
    return null;
  }
}

export function collapseSpaces(s) {
  return String(s).replace(/\s+/g, " ").trim();
}

export function trimSpaces(str) {
  return String(str).trim();
}

export function isDataURL(value) {
  return typeof value === "string" && /^data:[^,]+;base64,/i.test(value);
}

export function getImageSizeFromDataURL(dataUrl) {
  return new Promise((resolve, reject) => {
    if (!isDataURL(dataUrl)) {
      reject(new Error("Invalid data URL"));
      return;
    }
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("Failed to load image"));
    image.src = dataUrl;
  });
}

export function ensureImageFormatSupported(dataUrl) {
  return Promise.resolve(dataUrl);
}

export class Stopwatch {
  constructor() {
    this.start = performance.now();
    this.lap = this.start;
  }
  get elapsed() {
    return performance.now() - this.start;
  }
  getElapsedTime() {
    return this.elapsed;
  }
  getTime() {
    return this.elapsed;
  }
  click() {
    const now = performance.now();
    const delta = now - this.lap;
    this.lap = now;
    return delta;
  }
  restart() {
    this.start = performance.now();
    this.lap = this.start;
  }
  toString() {
    return `${Math.round(this.elapsed)}ms`;
  }
}

export async function showFontAwesomePicker(...args) {
  void args;
  warnOnce("showFontAwesomePicker() is not implemented; returns null");
  return null;
}

export function getSanitizedFilename(name) {
  return String(name ?? "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

/** Get the filename portion of a character avatar (drops the extension). */
export function getCharaFilename(chid) {
  warnOnce("getCharaFilename() returns null in the NyaaChat compat layer");
  void chid;
  return null;
}

/** Poll until `condition()` is truthy or the timeout elapses. */
export function waitUntilCondition(condition, timeout = 1000, interval = 100) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      let ok = false;
      try {
        ok = condition();
      } catch (err) {
        reject(err);
        return;
      }
      if (ok) {
        resolve();
      } else if (Date.now() - start >= timeout) {
        reject(new Error("waitUntilCondition timed out"));
      } else {
        setTimeout(tick, interval);
      }
    };
    tick();
  });
}

/** Trigger a browser download of `content`. */
export function download(content, fileName, contentType) {
  const a = document.createElement("a");
  const file = new Blob([content], { type: contentType || "text/plain" });
  a.href = URL.createObjectURL(file);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function getSortableDelay() {
  return 50;
}

// --- host-coupled / heavy helpers: resolve but warn -------------------------
function stub(name, fallback) {
  return (...args) => {
    void args;
    warnOnce(`${name}() is not implemented in the NyaaChat compat layer`);
    return fallback;
  };
}

export const getBase64Async = stub("getBase64Async", Promise.resolve(""));
export const parseJsonFile = stub("parseJsonFile", Promise.resolve(null));
export const extractTextFromPDF = stub("extractTextFromPDF", Promise.resolve(""));
export const extractTextFromHTML = stub("extractTextFromHTML", "");
export const extractTextFromMarkdown = stub("extractTextFromMarkdown", "");
export const getFileText = stub("getFileText", Promise.resolve(""));
export const saveBase64AsFile = stub("saveBase64AsFile", Promise.resolve(""));
export const flashHighlight = stub("flashHighlight", undefined);
export const timestampToMoment = stub("timestampToMoment", null);
