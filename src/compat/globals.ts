// Global shims SillyTavern extensions expect on `window`.
//
// ST runs with jQuery (`window.$` / `window.jQuery`), lodash (`window._`),
// toastr (`window.toastr`) and highlight.js (`window.hljs`) already on the page,
// and extensions call them freely. NyaaChat ships none of these.
//
// Per decision A3 we implement these on-demand, not wholesale. Parent-window
// jQuery is now required by the P2 extension settings host (e.g. st-Quote-TTS
// waits on `jQuery(async () => ...)`, polls `#extensions_settings`, loads
// settings.html through `$.get`, and wires form events). lodash / hljs remain
// unpolyfilled until a concrete extension needs them parent-side.
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

type JQueryCollection = {
  [index: number]: HTMLElement;
  length: number;
  forEach: Array<HTMLElement>["forEach"];
  map: Array<HTMLElement>["map"];
  [Symbol.iterator]: Array<HTMLElement>[typeof Symbol.iterator];
  append: (content: unknown) => JQueryCollection;
  appendTo: (target: string | HTMLElement | JQueryCollection) => JQueryCollection;
  empty: () => JQueryCollection;
  find: (selector: string) => JQueryCollection;
  closest: (selector: string) => JQueryCollection;
  filter: (selectorOrCb: string | ((this: HTMLElement, index: number, el: HTMLElement) => boolean)) => JQueryCollection;
  first: () => JQueryCollection;
  last: () => JQueryCollection;
  each: (cb: (this: HTMLElement, index: number, el: HTMLElement) => void) => JQueryCollection;
  text: (value?: string) => string | JQueryCollection;
  html: (value?: string) => string | JQueryCollection;
  val: (value?: string) => string | JQueryCollection;
  on: (event: string, handler: EventListener) => JQueryCollection;
  hasClass: (className: string) => boolean;
  addClass: (className: string) => JQueryCollection;
  removeClass: (className: string) => JQueryCollection;
  attr: (name: string, value?: string) => string | null | JQueryCollection;
  toArray: () => HTMLElement[];
};

type JQueryLite = {
  (arg: string | HTMLElement | Document | (() => void), context?: Document | HTMLElement): JQueryCollection | void;
  get: (url: string) => Promise<string>;
};

function toElements(content: unknown): Node[] {
  if (typeof content === "string") {
    const tpl = document.createElement("template");
    tpl.innerHTML = content;
    return Array.from(tpl.content.childNodes);
  }
  if (content instanceof Node) return [content];
  if (Array.isArray(content)) return content.filter((x): x is Node => x instanceof Node);
  const maybe = content as { toArray?: () => Node[] } | null;
  if (maybe?.toArray) return maybe.toArray();
  return [];
}

function makeCollection(items: HTMLElement[]): JQueryCollection {
  const arr = items as unknown as JQueryCollection;
  const source = arr as unknown as HTMLElement[];
  arr.append = (content) => {
    const nodes = toElements(content);
    source.forEach((el, index) => {
      for (const node of nodes) el.appendChild(index === 0 ? node : node.cloneNode(true));
    });
    return arr;
  };
  arr.appendTo = (target) => {
    const targetCollection =
      typeof target === "string"
        ? makeCollection(Array.from(document.querySelectorAll<HTMLElement>(target)))
        : target instanceof HTMLElement
          ? makeCollection([target])
          : target;
    targetCollection.append(arr);
    return arr;
  };
  arr.empty = () => {
    arr.forEach((el) => (el.textContent = ""));
    return arr;
  };
  arr.find = (selector) => makeCollection(source.flatMap((el) => Array.from(el.querySelectorAll<HTMLElement>(selector))));
  arr.closest = (selector) => makeCollection(source.map((el) => el.closest<HTMLElement>(selector)).filter(Boolean) as HTMLElement[]);
  arr.filter = (selectorOrCb) => {
    if (typeof selectorOrCb === "string") return makeCollection(source.filter((el) => el.matches(selectorOrCb)));
    return makeCollection(source.filter((el, i) => selectorOrCb.call(el, i, el)));
  };
  arr.first = () => makeCollection(source[0] ? [source[0]] : []);
  arr.last = () => makeCollection(source.length ? [source[source.length - 1]] : []);
  arr.each = (cb) => {
    source.forEach((el, i) => cb.call(el, i, el));
    return arr;
  };
  arr.text = (value) => {
    if (value === undefined) return arr.map((el) => el.textContent ?? "").join("");
    arr.forEach((el) => (el.textContent = value));
    return arr;
  };
  arr.html = (value) => {
    if (value === undefined) return arr[0]?.innerHTML ?? "";
    arr.forEach((el) => (el.innerHTML = value));
    return arr;
  };
  arr.val = (value) => {
    const fields = arr as unknown as Array<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>;
    if (value === undefined) return fields[0]?.value ?? "";
    fields.forEach((el) => (el.value = value));
    return arr;
  };
  arr.on = (event, handler) => {
    arr.forEach((el) => el.addEventListener(event, handler));
    return arr;
  };
  arr.hasClass = (className) => !!arr[0]?.classList.contains(className);
  arr.addClass = (className) => {
    arr.forEach((el) => el.classList.add(className));
    return arr;
  };
  arr.removeClass = (className) => {
    arr.forEach((el) => el.classList.remove(className));
    return arr;
  };
  arr.attr = (name, value) => {
    if (value === undefined) return arr[0]?.getAttribute(name) ?? null;
    arr.forEach((el) => el.setAttribute(name, value));
    return arr;
  };
  arr.toArray = () => [...arr];
  return arr;
}

function createJQueryLite(): JQueryLite {
  const jq = ((arg: string | HTMLElement | Document | (() => void), context?: Document | HTMLElement) => {
    if (typeof arg === "function") {
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", arg, { once: true });
      else queueMicrotask(arg);
      return;
    }
    if (typeof arg === "string") {
      const trimmed = arg.trim();
      if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
        return makeCollection(toElements(trimmed).filter((x): x is HTMLElement => x instanceof HTMLElement));
      }
      const root = context ?? document;
      return makeCollection(Array.from(root.querySelectorAll<HTMLElement>(arg)));
    }
    if (arg instanceof Document) return makeCollection([arg.documentElement]);
    return makeCollection(arg instanceof HTMLElement ? [arg] : []);
  }) as JQueryLite;
  jq.get = async (url: string) => {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
    return res.text();
  };
  return jq;
}

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
  if (!w.$ && !w.jQuery) {
    const jq = createJQueryLite();
    w.$ = jq;
    w.jQuery = jq;
  }
}

export { toastr };
