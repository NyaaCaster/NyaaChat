// crypto.randomUUID() is widely available since Chrome 92 / Firefox 95 /
// Safari 15.4 (2022). The fallback covers older WebView shells where the
// API may be missing — it is not cryptographically strong, but the IDs are
// only used as React keys / record identifiers, not for secrets.
export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  );
}
