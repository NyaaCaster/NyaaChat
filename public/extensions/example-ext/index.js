// NyaaChat 示例扩展 (Example Extension)
//
// A minimal, dependency-free "global API" extension — the kind NyaaChat's
// build-time extension loader supports today (decision B-revised). It reads the
// host APIs the compat layer installs on `window` (SillyTavern / TavernHelper /
// toastr / eventSource) rather than importing ST internal ESM modules, so it
// loads and runs as-is.
//
// It serves two purposes: prove the loader end-to-end, and act as a living
// template for writing your own bundled extension. Drop a folder under
// public/extensions/<id>/ with a manifest.json, then add it to registry.json.

(function () {
  const TAG = "[example-ext]";

  // The compat layer installs these on window before extensions load.
  const ST = window.SillyTavern;
  const TH = window.TavernHelper;

  if (!ST || typeof ST.getContext !== "function") {
    console.warn(TAG, "SillyTavern compat API not found — host not ready?");
    return;
  }

  // A marker the host/tests can assert on to confirm this extension ran.
  window.__exampleExtLoaded = true;

  const ctx = ST.getContext();
  console.log(TAG, "loaded. chat length =", ctx.chat.length, "char =", ctx.name2);

  // Count character messages as they render, via the shared event bus.
  let rendered = 0;
  ctx.eventSource.on(ctx.event_types.CHARACTER_MESSAGE_RENDERED, function (mesid) {
    rendered += 1;
    console.log(TAG, "character message rendered, mesid =", mesid, "total =", rendered);
    window.__exampleExtRenderCount = rendered;
  });

  // Persist a tiny load counter through the TavernHelper variable system to
  // demonstrate the shared, persisted store.
  if (TH && typeof TH.getVariables === "function") {
    try {
      const vars = TH.getVariables({ type: "global" });
      const loads = (vars.__exampleExtLoads || 0) + 1;
      TH.insertOrAssignVariables({ __exampleExtLoads: loads }, { type: "global" });
      console.log(TAG, "load count (persisted global var) =", loads);
    } catch (e) {
      console.warn(TAG, "variable demo failed", e);
    }
  }

  // A gentle one-time toast so the user sees the extension is alive.
  if (window.toastr && typeof window.toastr.info === "function") {
    window.toastr.info("示例扩展已加载", "NyaaChat 扩展");
  }
})();
