import lodash from "lodash";
import showdown from "showdown";
import * as Popper from "@popperjs/core";

// Global shims SillyTavern extensions expect on `window`.
//
// ST runs with jQuery (`window.$` / `window.jQuery`), lodash (`window._`),
// toastr (`window.toastr`), highlight.js (`window.hljs`), showdown
// (`window.showdown`) and Popper (`window.Popper`) already on the page (ST loads
// them via public/lib.js), and extensions call them freely. NyaaChat ships none
// of these.
//
// Per decision A3 we implement these on-demand, not wholesale. Parent-window
// jQuery is required by extension settings hosts, and lodash is required by
// JS-Slash-Runner during module evaluation. hljs is mounted as a no-op stub:
// JS-Slash-Runner reads/writes `hljs.highlightElement` at module top level
// (optimize_hljs.ts), so the global must exist as a mutable object or the whole
// module graph aborts with a ReferenceError. Actual syntax highlighting is a
// renderer detail the extension owns; the stub only keeps it from crashing.
//
// showdown (Markdown→HTML) and Popper (tooltip positioning, used by VueTippy)
// are the REAL libraries, not stubs: JS-Slash-Runner externalises them
// (vite-plugin-external maps `@popperjs/core`→`Popper`, `showdown`→`showdown`),
// so its bundle reads these as bare globals and needs working implementations.
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

const hljs = {
  highlightElement: (_element: HTMLElement) => undefined,
};

type JQueryElement = HTMLElement | Document | Window;

// This is intentionally small and permissive: third-party ST extensions use a
// broad jQuery surface, while NyaaChat only needs enough behavior to keep them
// from crashing in the host page.
type JQueryCollection = any;

type JQueryLite = {
  (arg: string | JQueryElement | (() => void), context?: Document | HTMLElement): JQueryCollection | void;
  get: (url: string) => Promise<string>;
};

function isElement(value: JQueryElement): value is HTMLElement {
  return value instanceof HTMLElement;
}

function toElements(content: unknown): Node[] {
  if (typeof content === "string") {
    const tpl = document.createElement("template");
    tpl.innerHTML = content;
    return Array.from(tpl.content.childNodes);
  }
  if (content instanceof Node) return [content];
  if (Array.isArray(content)) {
    // A jQuery-lite collection IS an Array, but its `.filter` is overridden with
    // jQuery semantics — the callback receives (index, element), not (element).
    // Calling `content.filter(x => x instanceof Node)` would test `0 instanceof
    // Node` (false) and drop every node, so `$(html).appendTo(target)` (which
    // routes a collection through here) would silently append nothing and leave
    // the element detached. Use the native filter to keep element semantics.
    return Array.prototype.filter.call(content, (x: unknown): x is Node => x instanceof Node) as Node[];
  }
  const maybe = content as { toArray?: () => Node[] } | null;
  if (maybe?.toArray) return maybe.toArray();
  return [];
}

// jQuery/Sizzle tolerates selector forms that native DOM APIs reject and throw
// SyntaxError on — most notably UNQUOTED attribute values like `[mesid=0]`
// (JSR's collapse-code-block builds `#chat > .mes[mesid=${n}]`). Native
// querySelectorAll/matches/closest require `[mesid="0"]`. We quote unquoted
// attribute values, then run native; the safe* wrappers fall back to the
// normalized form on any throw and never let an extension selector crash the
// host (mirrors the `:visible`/`:hidden` handling in `arr.is`).
function normalizeSelector(selector: string): string {
  return selector.replace(
    /\[\s*([-\w]+)\s*([~^$*|]?=)\s*(?!["'])([^\]\s]+)/g,
    (_m, name, op, val) => `[${name}${op}"${val}"`,
  );
}

function safeQueryAll(root: ParentNode, selector: string): HTMLElement[] {
  try {
    return Array.from(root.querySelectorAll<HTMLElement>(selector));
  } catch {
    try {
      return Array.from(root.querySelectorAll<HTMLElement>(normalizeSelector(selector)));
    } catch {
      return [];
    }
  }
}

function safeMatches(el: Element | null | undefined, selector: string): boolean {
  if (!el) return false;
  try {
    return el.matches(selector);
  } catch {
    try {
      return el.matches(normalizeSelector(selector));
    } catch {
      return false;
    }
  }
}

function safeClosest(el: Element, selector: string): HTMLElement | null {
  try {
    return el.closest<HTMLElement>(selector);
  } catch {
    try {
      return el.closest<HTMLElement>(normalizeSelector(selector));
    } catch {
      return null;
    }
  }
}

function resolveTarget(target: string | JQueryElement | JQueryCollection): JQueryCollection {
  if (typeof target === "string") return makeCollection(safeQueryAll(document, target));
  if (Array.isArray(target)) return target;
  return makeCollection([target]);
}

function makeCollection(items: JQueryElement[]): JQueryCollection {
  const arr = items as JQueryCollection;
  // Native Array.filter, captured before we overwrite `arr.filter` with the
  // jQuery-semantics version below. Every INTERNAL filtering must use this:
  // calling `arr.filter` after the override recurses into the jQuery wrapper
  // (which itself calls `arr.filter`), blowing the stack on the first use.
  const nativeFilter = Array.prototype.filter;
  const elements = () => nativeFilter.call(arr, isElement) as HTMLElement[];

  arr.append = (content) => {
    const nodes = toElements(content);
    elements().forEach((el, index) => {
      for (const node of nodes) el.appendChild(index === 0 ? node : node.cloneNode(true));
    });
    return arr;
  };
  arr.appendTo = (target) => {
    resolveTarget(target).append(arr);
    return arr;
  };
  arr.prependTo = (target) => {
    const targetElements = nativeFilter.call(resolveTarget(target), isElement) as HTMLElement[];
    const nodes = toElements(arr);
    targetElements.forEach((el, index) => {
      for (const node of nodes.slice().reverse()) {
        el.insertBefore(index === 0 ? node : node.cloneNode(true), el.firstChild);
      }
    });
    return arr;
  };
  arr.insertAfter = (target) => {
    const targetElements = nativeFilter.call(resolveTarget(target), isElement) as HTMLElement[];
    const nodes = toElements(arr);
    targetElements.forEach((el, index) => {
      for (const node of nodes) el.parentNode?.insertBefore(index === 0 ? node : node.cloneNode(true), el.nextSibling);
    });
    return arr;
  };
  arr.empty = () => {
    elements().forEach((el) => (el.textContent = ""));
    return arr;
  };
  arr.find = (selector) => makeCollection(elements().flatMap((el) => safeQueryAll(el, selector)));
  arr.children = (selector) => {
    const children = elements().flatMap((el) => Array.from(el.children).filter((x): x is HTMLElement => x instanceof HTMLElement));
    return makeCollection(selector ? children.filter((el) => safeMatches(el, selector)) : children);
  };
  arr.siblings = (selector) => {
    const siblings = elements().flatMap((el) =>
      Array.from(el.parentElement?.children ?? []).filter((x): x is HTMLElement => x instanceof HTMLElement && x !== el),
    );
    return makeCollection(selector ? siblings.filter((el) => safeMatches(el, selector)) : siblings);
  };
  arr.closest = (selector) => makeCollection(elements().map((el) => safeClosest(el, selector)).filter(Boolean) as HTMLElement[]);
  arr.parent = (selector) => {
    const parents = elements()
      .map((el) => el.parentElement)
      .filter((p): p is HTMLElement => p != null);
    const unique = [...new Set(parents)];
    return makeCollection(selector ? unique.filter((el) => safeMatches(el, selector)) : unique);
  };
  arr.filter = (selectorOrCb) => {
    if (typeof selectorOrCb === "string") return makeCollection(elements().filter((el) => safeMatches(el, selectorOrCb)));
    return makeCollection(nativeFilter.call(arr, (el: JQueryElement, i: number) => selectorOrCb.call(el, i, el)));
  };
  arr.first = () => makeCollection(arr[0] ? [arr[0]] : []);
  arr.last = () => makeCollection(arr.length ? [arr[arr.length - 1]] : []);
  arr.each = (cb) => {
    arr.forEach((el, i) => cb.call(el, i, el));
    return arr;
  };
  arr.text = (value) => {
    if (value === undefined) return elements().map((el) => el.textContent ?? "").join("");
    // jQuery accepts a function: (index, oldText) => newText. JSR's macro
    // pipeline (macro_like.ts) relies on this form.
    elements().forEach((el, i) => {
      el.textContent = typeof value === "function" ? value.call(el, i, el.textContent ?? "") : value;
    });
    return arr;
  };
  arr.html = (value) => {
    if (value === undefined) return elements()[0]?.innerHTML ?? "";
    // jQuery accepts a function: (index, oldHtml) => newHtml (used by macro_like).
    elements().forEach((el, i) => {
      el.innerHTML = typeof value === "function" ? value.call(el, i, el.innerHTML) : value;
    });
    return arr;
  };
  arr.val = (value) => {
    const fields = nativeFilter.call(
      arr,
      (el: JQueryElement): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
        el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement,
    ) as Array<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>;
    if (value === undefined) return fields[0]?.value ?? "";
    fields.forEach((el) => (el.value = value));
    return arr;
  };
  arr.on = (event, selectorOrHandler, handler) => {
    const listener = typeof selectorOrHandler === "function" ? selectorOrHandler : handler;
    if (typeof listener !== "function") return arr;
    arr.forEach((el) => el.addEventListener(event, listener));
    return arr;
  };
  arr.off = (event, selectorOrHandler, handler) => {
    const listener = typeof selectorOrHandler === "function" ? selectorOrHandler : handler;
    if (!event || typeof listener !== "function") return arr;
    arr.forEach((el) => el.removeEventListener(event, listener));
    return arr;
  };
  arr.trigger = (event) => {
    arr.forEach((el) => el.dispatchEvent(new Event(event, { bubbles: true })));
    return arr;
  };
  arr.is = (selector) => {
    // jQuery's `:visible` / `:hidden` are not valid CSS, so el.matches() throws
    // on them. JSR's collapse-code-block toggle queries `:visible`; emulate the
    // jQuery semantics (laid-out box = visible) instead of crashing.
    if (selector === ":visible") return elements().some((el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length));
    if (selector === ":hidden") return elements().some((el) => !(el.offsetWidth || el.offsetHeight || el.getClientRects().length));
    return safeMatches(elements()[0], selector);
  };
  arr.css = (name, value) => {
    if (value === undefined) return elements()[0] ? getComputedStyle(elements()[0]).getPropertyValue(name) : "";
    elements().forEach((el) => el.style.setProperty(name, value));
    return arr;
  };
  arr.prop = (name, value) => {
    const records = arr as unknown as Array<Record<string, unknown>>;
    if (value === undefined) return records[0]?.[name];
    records.forEach((el) => (el[name] = value));
    return arr;
  };
  arr.data = (name, value) => {
    const el = elements()[0];
    if (!el) return value === undefined ? undefined : arr;
    if (value === undefined) return el.dataset[name];
    elements().forEach((item) => (item.dataset[name] = String(value)));
    return arr;
  };
  arr.hasClass = (className) => !!elements()[0]?.classList.contains(className);
  arr.addClass = (className) => {
    elements().forEach((el) => el.classList.add(className));
    return arr;
  };
  arr.removeClass = (className) => {
    elements().forEach((el) => el.classList.remove(className));
    return arr;
  };
  arr.attr = (name, value) => {
    if (value === undefined) return elements()[0]?.getAttribute(name) ?? null;
    elements().forEach((el) => el.setAttribute(name, value));
    return arr;
  };
  arr.remove = () => {
    elements().forEach((el) => el.remove());
    return arr;
  };
  arr.replaceWith = (content) => {
    const nodes = toElements(content);
    elements().forEach((el, index) => el.replaceWith(...nodes.map((node) => (index === 0 ? node : node.cloneNode(true)))));
    return arr;
  };
  arr.clone = () => makeCollection(elements().map((el) => el.cloneNode(true) as HTMLElement));
  arr.get = (index) => (index === undefined ? [...arr] : arr[index]);
  arr.map = (cb) => {
    // jQuery semantics: callback is (index, element); returns are collected into
    // a new collection, array returns are flattened, null/undefined are skipped.
    // JSR's render pipeline (render$mes) chains .filter().map().toArray(), so the
    // result MUST be a collection (with toArray), not a plain Array.
    const out: unknown[] = [];
    arr.forEach((el: JQueryElement, i: number) => {
      const r = cb.call(el, i, el);
      if (r == null) return;
      if (Array.isArray(r)) {
        for (const x of r) if (x != null) out.push(x);
      } else {
        out.push(r);
      }
    });
    return makeCollection(out as JQueryElement[]);
  };
  arr.wrap = (wrapper) => {
    // jQuery wraps EACH element in its own (cloned) wrapper structure, inserting
    // the element at the innermost descendant. JSR uses `$pre.wrap('<div class="TH-render">')`.
    elements().forEach((el, i) => {
      const source = typeof wrapper === "function" ? wrapper.call(el, i) : wrapper;
      const wrapNode = toElements(source).find((n): n is HTMLElement => n instanceof HTMLElement);
      if (!wrapNode) return;
      el.parentNode?.insertBefore(wrapNode, el);
      let inner: HTMLElement = wrapNode;
      while (inner.firstElementChild) inner = inner.firstElementChild as HTMLElement;
      inner.appendChild(el);
    });
    return arr;
  };
  arr.toArray = () => [...arr];
  return arr;
}

function createJQueryLite(): JQueryLite {
  const jq = ((arg: string | JQueryElement | (() => void), context?: Document | HTMLElement) => {
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
      return makeCollection(safeQueryAll(root, arg));
    }
    return makeCollection([arg]);
  }) as JQueryLite;
  jq.get = async (url: string) => {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
    return res.text();
  };
  return jq;
}

// ST extensions (e.g. JS-Slash-Runner's Reference.vue) call `Popper.createPopper`
// from a component's `onMounted` while the popper element is still `display:none`
// — or while its host subtree is collapsed / parked off-screen. Popper v2 then
// resolves `offsetParent` to `null` on its first async update and throws inside
// `forceUpdate` (`Cannot read properties of null (reading 'clientWidth')`) as an
// unhandled promise rejection. Real ST tolerates the same call as harmless noise,
// but it still pollutes the console. Wrap the injected `createPopper` so the
// instance's `forceUpdate` never throws on a hidden/detached element; once the
// element is shown and `update()` runs again, positioning works normally. The
// first async update is dispatched via `instance.forceUpdate` (a property lookup)
// in a microtask, so replacing the property synchronously after createPopper
// returns reliably intercepts it. Generic host contract for the Popper we inject,
// with no extension-specific logic.
function createDefensivePopper(P: typeof Popper): typeof Popper {
  const realCreatePopper = P.createPopper;
  if (typeof realCreatePopper !== "function") return P;
  const safe: Record<string, unknown> = {};
  for (const key of Object.keys(P)) {
    safe[key] = (P as unknown as Record<string, unknown>)[key];
  }
  safe.createPopper = (...args: Parameters<typeof realCreatePopper>) => {
    const instance = realCreatePopper(...args);
    const originalForceUpdate = instance.forceUpdate;
    if (typeof originalForceUpdate === "function") {
      instance.forceUpdate = function defensiveForceUpdate(this: unknown) {
        try {
          return (originalForceUpdate as () => void).call(instance);
        } catch {
          // Geometry read on a hidden/detached element. Skip this cycle; a
          // later update() (once the element is visible) positions it correctly.
          return undefined;
        }
      };
    }
    return instance;
  };
  return safe as unknown as typeof Popper;
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
  if (!w._) {
    w._ = lodash;
  }
  if (!w.hljs) {
    w.hljs = hljs;
  }
  if (!w.showdown) {
    w.showdown = showdown;
  }
  if (!w.Popper) {
    w.Popper = createDefensivePopper(Popper);
  }
  if (!w.$ && !w.jQuery) {
    const jq = createJQueryLite();
    w.$ = jq;
    w.jQuery = jq;
  }
}

export { toastr };
