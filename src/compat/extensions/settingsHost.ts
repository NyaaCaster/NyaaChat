// Stable DOM host for SillyTavern-style extension settings UI.
//
// ST extensions append their settings panels into `#extensions_settings` while
// their entry modules are evaluating. NyaaChat's React modals mount/unmount, so
// this node must live outside React and be moved into the visible modal only
// while the user opens the extension panel. Its identity is stable for the whole
// page session.

const HOST_ID = "extensions_settings";
const PARKING_ID = "nyaachat_extensions_settings_parking";

// The parking spot must hide the host WITHOUT `display:none` / `hidden`.
// Extensions (JS-Slash-Runner) mount their settings UI into the host at page
// load, while it is parked. Components that run Popper/tippy in onMounted (e.g.
// JSR's Reference.vue) read element geometry — `clientWidth`, offsetParent —
// during that mount. Under `display:none` those are 0/null and Popper throws
// (`Cannot read properties of null (reading 'clientWidth')`). So we hide the
// parked host off-screen while keeping a real layout box: it has size and an
// offsetParent, just nowhere visible and non-interactive.
const PARKING_STYLE = [
  "position:absolute",
  "left:-99999px",
  "top:0",
  "width:1024px",
  "height:1px",
  "overflow:hidden",
  "pointer-events:none",
  "opacity:0",
].join(";");

function ensureParking(): HTMLElement {
  let parking = document.getElementById(PARKING_ID);
  if (!parking) {
    parking = document.createElement("div");
    parking.id = PARKING_ID;
    parking.setAttribute("aria-hidden", "true");
    parking.style.cssText = PARKING_STYLE;
    document.body.appendChild(parking);
  }
  return parking;
}

/** Ensure the stable ST settings container exists before extensions load. */
export function ensureExtensionSettingsHost(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = HOST_ID;
    host.className = "nyaachat-extensions-settings-host";
    ensureParking().appendChild(host);
  }
  return host;
}

/** Move the stable host into a visible React-owned mount point. */
export function attachExtensionSettingsHost(target: HTMLElement | null): void {
  const host = ensureExtensionSettingsHost();
  if (!host || !target) return;
  host.hidden = false;
  host.removeAttribute("aria-hidden");
  // Visibility is governed by the parent: inside `target` the host is on-screen;
  // back in parking it's the off-screen box. The host itself carries no hiding
  // style, so it never becomes display:none under a mounted extension UI.
  target.appendChild(host);
}

/** Park the host outside React before the modal subtree unmounts. Keeps the
 *  extension-owned DOM alive and laid out (off-screen), not display:none. */
export function parkExtensionSettingsHost(): void {
  const host = ensureExtensionSettingsHost();
  if (!host) return;
  host.hidden = false;
  host.setAttribute("aria-hidden", "true");
  ensureParking().appendChild(host);
}
