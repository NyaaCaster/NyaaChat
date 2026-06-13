// Front-end card renderer (React).
//
// Renders an HTML "front-end card" emitted by the model into a same-origin,
// non-sandboxed iframe — the NyaaChat-native equivalent of JS-Slash-Runner's
// render pipeline (SSOT §2.4, §4; decision A3). This is the P4 core deliverable.
//
// Why an iframe at all: the card is a self-contained mini-app (its own <style>,
// <script>, often a CDN jQuery/Vue). Injecting it inline would let its CSS/JS
// leak into the host page and fight React for the DOM. The iframe gives it an
// isolated document while staying same-origin so its code can still reach the
// host via window.parent (the bridge in srcdoc.ts).
//
// React-DOM-vs-external-DOM conflict (hard bone #1): the iframe is the escape
// zone. React owns the <iframe> element and its `srcdoc`; everything the card
// does happens inside the iframe's document, which React never diffs. We never
// hand a React-owned node to the card.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Code2 } from "lucide-react";
import { buildCardSrcdoc } from "./srcdoc";
import { eventSource, event_types } from "../events";

interface FrontendCardProps {
  /** The extracted HTML to render inside the iframe. */
  html: string;
  /** Floor number of the host message (for the iframe id ST extensions expect). */
  mesid?: number;
  /** Index of this card within the message (a message may hold several). */
  index?: number;
}

export const FrontendCard = React.memo(function FrontendCard({
  html,
  mesid,
  index = 0,
}: FrontendCardProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [showSource, setShowSource] = useState(false);

  // ST id convention: TH-message--{mesid}--{idx}. The TavernHelper render API
  // reverse-looks-up the floor from this id, so we keep the exact shape.
  const frameId = useMemo(
    () => `TH-message--${mesid ?? "x"}--${index}`,
    [mesid, index],
  );

  const srcdoc = useMemo(() => buildCardSrcdoc(html), [html]);

  // Emit render-lifecycle events so extensions / the host can react. Mirrors
  // JSR's message_iframe_render_started / _ended.
  useEffect(() => {
    eventSource.emit("message_iframe_render_started", frameId);
  }, [frameId, srcdoc]);

  const handleLoad = () => {
    eventSource.emit("message_iframe_render_ended", frameId);
    // A message-rendered event for parity with ST's pipeline triggers.
    if (typeof mesid === "number") {
      eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, mesid);
    }
  };

  return (
    <div className="not-prose my-2 relative group/card">
      <button
        type="button"
        onClick={() => setShowSource((v) => !v)}
        className="absolute right-2 top-2 z-10 p-1.5 rounded-md bg-black/30 hover:bg-black/50 text-white/80 hover:text-white opacity-0 group-hover/card:opacity-100 transition-opacity"
        title={showSource ? "显示渲染结果" : "显示前端代码"}
      >
        <Code2 size={13} />
      </button>
      {showSource ? (
        <pre className="overflow-auto text-xs rounded-lg bg-gray-900 text-gray-100 p-3 max-h-[60vh]">
          <code>{html}</code>
        </pre>
      ) : (
        <iframe
          ref={iframeRef}
          id={frameId}
          name={frameId}
          title={frameId}
          srcDoc={srcdoc}
          loading="lazy"
          className="w-full block border-0 bg-transparent"
          // Same-origin, NOT sandboxed — required for the bridge / height sync.
          // See srcdoc.ts security note.
          style={{ height: 60, minHeight: 60, background: "transparent" }}
          onLoad={handleLoad}
        />
      )}
    </div>
  );
});
