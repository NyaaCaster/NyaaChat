// NyaaChat ↔ SillyTavern ESM-import shim — shared host accessor.
//
// The files served at /script.js and /scripts/*.js are RAW static ES modules,
// reached by an ST extension's import graph (e.g.
//   import { getContext } from "../../../extensions.js"
//   import { saveSettingsDebounced } from "../../../../script.js"
// ). They run OUTSIDE the app's Vite bundle, so they cannot import from
// src/compat. Instead they reach the compat layer through a single private
// global, window.__NYAA_COMPAT__, which installCompatLayer() installs before any
// extension loads. This module centralises that access so each shim stays thin.
//
// Why a private global and not window.SillyTavern: the bridge carries internals
// (a live subscribe) we don't want on the ST surface an extension probes.

const BRIDGE_KEY = "__NYAA_COMPAT__";

// Must equal the realm the installer stamps onto the bridge (see
// src/compat/index.ts). A handshake, not a secret: it only has to agree on both
// sides, and guards against binding to a foreign object squatting the same key.
const BRIDGE_REALM = "Nyaa be with you.";

function bridge() {
  const b = typeof window !== "undefined" ? window[BRIDGE_KEY] : undefined;
  if (!b || typeof b.getContext !== "function" || b.realm !== BRIDGE_REALM) {
    throw new Error(
      "[nyaa-shim] SillyTavern compat bridge missing or invalid — an extension " +
        "imported a shim before the host was ready (installCompatLayer not run).",
    );
  }
  return b;
}

/** The live getContext() object (a fresh object each call, ST semantics). */
export function ctx() {
  return bridge().getContext();
}

/** Shared event bus + type table. Stable singletons — safe to capture once. */
export const eventSource = bridge().eventSource;
export const event_types = bridge().event_types;

/**
 * Subscribe to host runtime changes (chat / character / user). This is how the
 * shims re-export ST's *live bindings* faithfully: ST's `chat`, `name1`,
 * `characters`, … are `export let` that ST reassigns and importers track. Our
 * runtimeStore replaces its chat array on each sync, so a captured snapshot goes
 * stale — instead a shim reassigns its own module-scope `let` on every notify
 * and ESM live bindings propagate the new value to every importer.
 * @param {() => void} cb Called (no args) on each change; re-read ctx() inside.
 * @returns {() => void} unsubscribe
 */
export function onHostChange(cb) {
  return bridge().subscribe(cb);
}

const _warned = new Set();

/** One-shot console warning for unimplemented surface, so a repeated call from
 *  an extension doesn't spam the console. */
export function warnOnce(msg) {
  if (_warned.has(msg)) return;
  _warned.add(msg);
  console.warn("[nyaa-shim]", msg);
}

/**
 * Build a forwarding function: calls ctx()[name](...args) when the host provides
 * it as a function, else warns once and returns `fallback`. Lets a shim export a
 * symbol that resolves at import time (so the importing extension loads) even
 * when the underlying capability isn't wired yet.
 */
export function forward(name, fallback) {
  return (...args) => {
    const fn = ctx()[name];
    if (typeof fn === "function") return fn(...args);
    warnOnce(`${name}() is not implemented in the NyaaChat compat layer`);
    return fallback;
  };
}
