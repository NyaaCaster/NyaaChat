// Shim for SillyTavern's public/scripts/preset-manager.js.
//
// NyaaChat has no ST-style preset manager; its generation settings live in the
// app's own provider config. This shim returns inert values that let extensions
// query "the current preset" without crashing. JS-Slash-Runner reads
// getSelectedPresetName() / getSelectedPreset() at store init (Pinia setup), so
// these MUST exist and return primitives, not throw — an empty name maps to
// "no preset selected", which JSR's store handles gracefully.

const presetManager = {
  getSelectedPreset: () => null,
  getSelectedPresetName: () => "",
  // ST shape: { presets: [...], preset_names: {name: index} }. JSR reads
  // getPresetList().presets[i] and getPresetList().preset_names[name], so the
  // two keys MUST exist (returning a bare [] makes `.presets` undefined and
  // crashes the preset store at mount). Empty state = no presets installed.
  getPresetList: () => ({ presets: [], preset_names: {} }),
  getAllPresets: () => [],
  findPreset: () => null,
  getPreset: () => null,
  getDefaultPreset: () => null,
  savePreset: () => Promise.resolve(),
  deletePreset: () => Promise.resolve(false),
  selectPreset: () => Promise.resolve(false),
};

export function getPresetManager() {
  return presetManager;
}
