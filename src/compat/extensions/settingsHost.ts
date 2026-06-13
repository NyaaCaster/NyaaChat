// Stable DOM host for SillyTavern-style extension settings UI.
//
// ST extensions append their settings panels into `#extensions_settings` while
// their entry modules are evaluating. NyaaChat's React modals mount/unmount, so
// this node must live outside React and be moved into the visible modal only
// while the user opens the extension panel. Its identity is stable for the whole
// page session.

const HOST_ID = "extensions_settings";
const PARKING_ID = "nyaachat_extensions_settings_parking";

function ensureParking(): HTMLElement {
  let parking = document.getElementById(PARKING_ID);
  if (!parking) {
    parking = document.createElement("div");
    parking.id = PARKING_ID;
    parking.hidden = true;
    parking.setAttribute("aria-hidden", "true");
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
  target.appendChild(host);
}

/** Park the host outside React before the modal subtree unmounts. */
export function parkExtensionSettingsHost(): void {
  const host = ensureExtensionSettingsHost();
  if (!host) return;
  host.hidden = true;
  host.setAttribute("aria-hidden", "true");
  ensureParking().appendChild(host);
}
