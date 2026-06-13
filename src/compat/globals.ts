// Global shims SillyTavern extensions expect on `window`.
//
// ST runs with jQuery (`window.$`), lodash (`window._`), toastr
// (`window.toastr`) and highlight.js (`window.hljs`) already on the page, and
// extensions call them freely. NyaaChat ships none of these.
//
// Per decision A3 we implement these on-demand, not wholesale. In P1 the only
// one extensions reach for outside an iframe is `toastr` (user-facing notices
// during load/settings). jQuery / lodash / hljs are consumed by the *front-end
// card* code, which runs inside the render iframe and pulls them from a CDN
// (SSOT §2.4) — so they are deliberately NOT polyfilled on the parent window
// here. If a future extension needs them parent-side we add them then.
//
// Everything here is idempotent: main.tsx mounts under StrictMode, so installs
// run twice in dev. We never clobber a global that's already present.

/** toastr-compatible surface. ST extensions call toastr.success(msg, title?,
 *  opts?) etc. We default to console output and let the app register a real UI
 *  sink via setToastSink(). */
export interface ToastrLike {
  success: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
  warning: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
}

export type ToastLevel = "success" | "info" | "warning" | "error";
export type ToastSink = (level: ToastLevel, message: string, title?: string) => void;

let toastSink: ToastSink | null = null;

/** Register the app's toast UI as the destination for extension toastr calls.
 *  Until set, toasts go to the console. */
export function setToastSink(fn: ToastSink | null): void {
  toastSink = fn;
}

function emitToast(level: ToastLevel, message: string, title?: string): void {
  if (toastSink) {
    try {
      toastSink(level, message, title);
      return;
    } catch (err) {
      console.error("[compat] toast sink threw", err);
    }
  }
  const label = title ? `${title}: ${message}` : message;
  const fn = level === "error" ? console.error : level === "warning" ? console.warn : console.log;
  fn(`[ext toast] ${label}`);
}

const toastr: ToastrLike = {
  success: (m, t) => emitToast("success", m, t),
  info: (m, t) => emitToast("info", m, t),
  warning: (m, t) => emitToast("warning", m, t),
  error: (m, t) => emitToast("error", m, t),
};

/**
 * Mount the minimal global shims on `window`. Idempotent — existing globals are
 * left untouched so we never stomp a real jQuery/lodash someone else loaded.
 */
export function installGlobals(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as Record<string, unknown>;
  if (!w.toastr) {
    w.toastr = toastr;
  }
}

export { toastr };
