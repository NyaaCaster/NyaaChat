// NyaaChat ESM-import example extension.
//
// Unlike example-ext (a global-API IIFE that reads window.SillyTavern), this one
// imports SillyTavern core modules by RELATIVE PATH, exactly like a real ST
// third-party extension. It is the living proof of the ESM-import shim: the
// loader serves this file at ST's canonical depth
// (/scripts/extensions/third-party/esm-example/index.js), so these "../../.."
// specifiers resolve to the compat shim modules at the web root:
//   ../../../extensions.js     → /scripts/extensions.js
//   ../../../../script.js      → /script.js
//   ../../../../scripts/utils.js → /scripts/utils.js

import { extension_settings, getContext, loadExtensionSettings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, name1, name2 } from "../../../../script.js";
import { uuidv4, getStringHash, delay } from "../../../../scripts/utils.js";

const NAME = "esm-example";

async function init() {
  // Settings: read/write the shared, stable extension_settings object (the same
  // identity the host holds — a write here is visible via getContext()).
  extension_settings[NAME] = extension_settings[NAME] || { loads: 0 };
  extension_settings[NAME].loads += 1;
  extension_settings[NAME].lastId = uuidv4();
  saveSettingsDebounced();
  await loadExtensionSettings();

  const ctx = getContext();

  // Markers the host/tests assert on: confirm the imports resolved AND the
  // forwarded symbols actually reach the compat layer with live data.
  window.__esmExample = {
    loaded: true,
    chatLength: ctx.chat.length,
    charFromContext: ctx.name2,
    charFromScriptJs: name2, // live binding re-exported by the script.js shim
    userFromScriptJs: name1,
    hash: getStringHash("nyaa"), // pure util — must equal ST's hash value
    uuidLooksValid: /^[0-9a-f-]{36}$/i.test(extension_settings[NAME].lastId),
    loads: extension_settings[NAME].loads,
    settingsAreShared: getContext().extension_settings[NAME] === extension_settings[NAME],
    rendered: 0,
  };

  // Subscribe to a lifecycle event through the shared event bus.
  eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (mesid) => {
    window.__esmExample.rendered += 1;
    window.__esmExample.lastRenderedMesid = mesid;
  });

  await delay(0);
  console.log("[esm-example] loaded via ESM import shim", window.__esmExample);
}

init().catch((err) => console.error("[esm-example] init failed", err));
