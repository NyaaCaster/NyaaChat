// Shim for SillyTavern's public/scripts/preset-manager.js.

const presetManager = {
  getSelectedPreset: () => null,
  getPresetList: () => [],
  findPreset: () => null,
  savePreset: () => Promise.resolve(),
  selectPreset: () => Promise.resolve(false),
};

export function getPresetManager() {
  return presetManager;
}
