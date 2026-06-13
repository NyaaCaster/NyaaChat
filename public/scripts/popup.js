// Shim for SillyTavern's public/scripts/popup.js.
//
// A minimal, dependency-free popup using the browser's native dialogs. ST's
// Popup is a rich custom-element modal; extensions mostly use it for confirm /
// input / message, which window.confirm / window.prompt / window.alert cover.
// HTML content is reduced to text (native dialogs are text-only).

import { warnOnce } from "./_compat-host.js";

export const POPUP_TYPE = {
  TEXT: 1,
  CONFIRM: 2,
  INPUT: 3,
  DISPLAY: 4,
  CROP: 5,
};

export const POPUP_RESULT = {
  AFFIRMATIVE: 1,
  NEGATIVE: 0,
  CANCELLED: null,
};

function toText(content) {
  if (content == null) return "";
  if (typeof content === "string") {
    // Strip tags so HTML content reads sensibly in a native dialog.
    const div = document.createElement("div");
    div.innerHTML = content;
    return (div.textContent || "").trim();
  }
  if (content instanceof Node) return (content.textContent || "").trim();
  return String(content);
}

/**
 * The function form most extensions call. Returns a Promise resolving to the
 * popup result: a string for INPUT, a POPUP_RESULT for CONFIRM, AFFIRMATIVE
 * otherwise.
 */
export function callGenericPopup(content, type, inputValue = "", options = {}) {
  void options;
  const text = toText(content);
  switch (type) {
    case POPUP_TYPE.CONFIRM:
      return Promise.resolve(
        window.confirm(text) ? POPUP_RESULT.AFFIRMATIVE : POPUP_RESULT.NEGATIVE,
      );
    case POPUP_TYPE.INPUT: {
      const res = window.prompt(text, inputValue ?? "");
      return Promise.resolve(res === null ? POPUP_RESULT.CANCELLED : res);
    }
    default:
      window.alert(text);
      return Promise.resolve(POPUP_RESULT.AFFIRMATIVE);
  }
}

/** Legacy callPopup(content, type, inputValue, options). Same behaviour. */
export function callPopup(content, type, inputValue = "", options = {}) {
  const popupType =
    type === "confirm" ? POPUP_TYPE.CONFIRM : type === "input" ? POPUP_TYPE.INPUT : POPUP_TYPE.TEXT;
  return callGenericPopup(content, popupType, inputValue, options);
}

/** Minimal class form: `new Popup(content, type, inputValue, options).show()`. */
export class Popup {
  constructor(content, type = POPUP_TYPE.TEXT, inputValue = "", options = {}) {
    this.content = content;
    this.type = type;
    this.inputValue = inputValue;
    this.options = options;
    this.result = undefined;
    this.value = undefined;
  }

  show() {
    return callGenericPopup(this.content, this.type, this.inputValue, this.options).then((r) => {
      if (typeof r === "string") {
        this.value = r;
        this.result = POPUP_RESULT.AFFIRMATIVE;
      } else {
        this.result = r;
      }
      return r;
    });
  }

  completeAffirmative() {
    warnOnce("Popup.completeAffirmative() is a no-op in the NyaaChat compat layer");
  }
}
