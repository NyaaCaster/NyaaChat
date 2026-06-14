// Shim for SillyTavern's public/scripts/RossAscends-mods.js.

export function isMobile() {
  return typeof matchMedia === "function" && matchMedia("(max-width: 768px)").matches;
}

export const favsToHotswap = [];
