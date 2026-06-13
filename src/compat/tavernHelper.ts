// Minimal TavernHelper stub.
//
// Front-end cards call into `TavernHelper.*` (and the flattened global helpers
// predefine.js installs) for chat data, variables, generate, etc. The full
// surface is large (SSOT §2.4) and lands in P5. For P4 — getting cards to
// *render* — we expose a stub so a card that probes TavernHelper on load does
// not immediately throw a TypeError and blank out.
//
// The contract: read-style methods return empty/neutral values; action-style
// methods are no-ops that warn once. P5 replaces these with real
// implementations backed by runtimeStore / chatPipeline / the LLM client.

const warned = new Set<string>();

function warnOnce(name: string): void {
  if (warned.has(name)) return;
  warned.add(name);
  console.warn(`[compat] TavernHelper.${name} is a P4 stub — not implemented until P5`);
}

function noop(name: string): (...args: unknown[]) => undefined {
  return () => {
    warnOnce(name);
    return undefined;
  };
}

/** The stub object placed at window.TavernHelper. Intentionally small; grows
 *  into the real API in P5. */
export function createTavernHelperStub(): Record<string, unknown> {
  return {
    // --- chat message reads (return empty so cards degrade gracefully) ---
    getChatMessages: () => [],
    getLastMessageId: () => -1,

    // --- variables (all scopes resolve to empty maps) ---
    getVariables: () => ({}),
    replaceVariables: noop("replaceVariables"),
    insertOrAssignVariables: noop("insertOrAssignVariables"),

    // --- generation / slash (deferred to P5) ---
    generate: noop("generate"),
    generateRaw: noop("generateRaw"),
    triggerSlash: noop("triggerSlash"),

    // --- misc ---
    getCharData: () => null,
    getTavernRegexes: () => [],

    // predefine.js flattens TavernHelper._bind onto globals; we don't ship that
    // mechanism, so expose an empty _bind to keep the bridge defensive.
    _bind: {},
  };
}
