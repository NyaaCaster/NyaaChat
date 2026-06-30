// Transitional localStorage→IndexedDB migration UI.
//
// When a returning user first opens NyaaChat after the storage migration ships,
// their data still lives in localStorage.  This module shows a blocking
// (non-dismissable) pre-React dialog that explains the one-time migration and
// runs it on confirmation.
//
// Once the transition period is over and every active user has been migrated,
// set MIGRATION_DIALOG_ENABLED to false and the entire codepath becomes a no-op.
// At that point the file can be deleted and the import in main.tsx removed.

// ---------------------------------------------------------------------------
// Feature toggle — set to false to disable the dialog entirely.
// ---------------------------------------------------------------------------
export const MIGRATION_DIALOG_ENABLED = true;

// ---------------------------------------------------------------------------
// Styles (injected once)
// ---------------------------------------------------------------------------
const OVERLAY_ID = "nyaachat-migration-overlay";

const STYLES = /* css */ `
#${OVERLAY_ID} {
  position: fixed; inset: 0; z-index: 2147483647;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.65);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  animation: nyaachat-mig-fadein 0.25s ease;
}
@keyframes nyaachat-mig-fadein {
  from { opacity: 0; }
  to   { opacity: 1; }
}
#${OVERLAY_ID} .nc-mig-card {
  background: #fff;
  border-radius: 16px;
  max-width: 420px; width: 90vw;
  padding: 28px 24px 20px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.35);
  text-align: center;
  animation: nyaachat-mig-pop 0.3s cubic-bezier(.34,1.56,.64,1);
}
@keyframes nyaachat-mig-pop {
  from { transform: scale(0.85); opacity: 0; }
  to   { transform: scale(1);    opacity: 1; }
}
#${OVERLAY_ID} .nc-mig-icon {
  font-size: 40px; margin-bottom: 8px;
}
#${OVERLAY_ID} .nc-mig-title {
  font-size: 18px; font-weight: 700;
  color: #111827; margin: 0 0 8px;
}
#${OVERLAY_ID} .nc-mig-body {
  font-size: 13px; line-height: 1.6;
  color: #4b5563; margin: 0 0 20px;
}
#${OVERLAY_ID} .nc-mig-body em {
  font-style: normal; font-weight: 600; color: #1d4ed8;
}
#${OVERLAY_ID} .nc-mig-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 32px;
  border: none; border-radius: 10px;
  background: #2563eb; color: #fff;
  font-size: 14px; font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
#${OVERLAY_ID} .nc-mig-btn:hover   { background: #1d4ed8; }
#${OVERLAY_ID} .nc-mig-btn:active  { background: #1e40af; }
#${OVERLAY_ID} .nc-mig-btn:disabled {
  background: #93c5fd; cursor: not-allowed;
}
#${OVERLAY_ID} .nc-mig-spinner {
  display: inline-block; width: 14px; height: 14px;
  border: 2px solid rgba(255,255,255,.35);
  border-top-color: #fff; border-radius: 50%;
  animation: nyaachat-mig-spin 0.6s linear infinite;
}
@keyframes nyaachat-mig-spin {
  to { transform: rotate(360deg); }
}
/* Dark-mode overrides — match the app's dark palette */
@media (prefers-color-scheme: dark) {
  #${OVERLAY_ID} .nc-mig-card   { background: #1e1e2e; }
  #${OVERLAY_ID} .nc-mig-title  { color: #e5e7eb; }
  #${OVERLAY_ID} .nc-mig-body   { color: #9ca3af; }
  #${OVERLAY_ID} .nc-mig-body em { color: #60a5fa; }
}
`;

let stylesInjected = false;

function injectStyles(): void {
  if (stylesInjected) return;
  const s = document.createElement("style");
  s.textContent = STYLES;
  document.head.appendChild(s);
  stylesInjected = true;
}

// ---------------------------------------------------------------------------
// Dialog helpers
// ---------------------------------------------------------------------------

interface DialogOpts {
  icon: string;
  title: string;
  body: string;
  buttonText: string;
  /** If true, clicking the button returns immediately (no spinner). */
  immediate?: boolean;
}

function showDialog(opts: DialogOpts): Promise<void> {
  return new Promise((resolve) => {
    injectStyles();

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;

    overlay.innerHTML = `
      <div class="nc-mig-card">
        <div class="nc-mig-icon">${opts.icon}</div>
        <h2 class="nc-mig-title">${opts.title}</h2>
        <p class="nc-mig-body">${opts.body}</p>
        <button class="nc-mig-btn" type="button">
          ${opts.immediate ? opts.buttonText : `<span class="nc-mig-spinner" style="display:none" data-spinner></span> ${opts.buttonText}`}
        </button>
      </div>`;

    const btn = overlay.querySelector(".nc-mig-btn") as HTMLButtonElement;
    const spinner = overlay.querySelector("[data-spinner]") as HTMLElement | null;

    btn.onclick = () => {
      if (opts.immediate) {
        overlay.remove();
        resolve();
        return;
      }
      btn.disabled = true;
      if (spinner) spinner.style.display = "inline-block";
      // Let the spinner render for one frame, then resolve
      requestAnimationFrame(() => {
        overlay.remove();
        resolve();
      });
    };

    document.body.appendChild(overlay);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Check whether there are localStorage keys that look like NyaaChat data. */
export function hasNyaaChatLocalStorageData(): boolean {
  if (typeof localStorage === "undefined") return false;
  const prefixes = ["nyaachat_", "rikkachat_"];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && prefixes.some((p) => k.startsWith(p))) return true;
    }
  } catch { /* localStorage may throw in some sandboxed contexts */ }
  return false;
}

/** Show the migration-confirmation dialog (blocking).  Resolves when the user
 *  clicks 确定. */
export function showMigrationConfirm(): Promise<void> {
  return showDialog({
    icon: "💾",
    title: "本地数据迁移",
    body:
      `检测到您的 NyaaChat 本地数据仍保存在<em>旧版存储</em>中（上限仅 10 MB）。<br><br>` +
      `为了提供更大的存储空间和更好的体验，需要将数据<em>一次性迁移到新版存储</em>（IndexedDB），` +
      `迁移完成后存储上限将大幅提升。<br><br>` +
      `迁移过程仅需几秒，数据不会丢失。`,
    buttonText: "开始迁移",
  });
}

/** Show the migration-complete dialog (blocking). */
export function showMigrationComplete(): Promise<void> {
  return showDialog({
    icon: "✅",
    title: "迁移完成",
    body:
      `本地数据已成功迁移到新版存储。<br><br>` +
      `现在可以放心使用，不再受旧版 10 MB 存储上限的限制。`,
    buttonText: "开始使用",
    immediate: true,
  });
}
