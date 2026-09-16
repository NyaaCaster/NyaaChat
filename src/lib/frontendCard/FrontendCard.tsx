// 前端卡渲染器（React）。
//
// 把模型吐出的 HTML「前端卡」渲染进一个同源、不加 sandbox 的 iframe —— 这是
// NyaaChat 自己的前端卡渲染通道。
//
// 为什么要 iframe：卡片是一个自包含的小应用（自带 <style>、<script>，常常还从
// CDN 拉 jQuery/Vue）。内联进宿主页面的话，它的 CSS/JS 会漏进主文档并和 React
// 抢 DOM。iframe 给它一个独立文档，同时保持同源，好让卡片自己量高度撑开宿主里的
// frameElement（高度脚本见 srcdoc.ts）。
//
// React-DOM-vs-外部 DOM 的冲突：iframe 就是隔离区。React 只拥有 <iframe> 元素和
// 它的 `srcdoc`；卡片内部发生的一切都在 iframe 的 document 里，React 从不 diff
// 那块 DOM。

import React, { useCallback, useMemo, useState } from "react";
import { Code2 } from "lucide-react";
import { subscribeVariables } from "../variables";
import { buildCardSrcdoc } from "./srcdoc";

interface FrontendCardProps {
  /** The extracted HTML to render inside the iframe. */
  html: string;
  /** Floor number of the host message (part of the iframe's stable id). */
  mesid?: number;
  /** Index of this card within the message (a message may hold several). */
  index?: number;
}

export const FrontendCard = React.memo(function FrontendCard({
  html,
  mesid,
  index = 0,
}: FrontendCardProps) {
  const [showSource, setShowSource] = useState(false);

  // NyaaChat's own iframe id — a stable, readable handle for the card frame.
  const frameId = useMemo(
    () => `nyaachat-card--${mesid ?? "x"}--${index}`,
    [mesid, index],
  );

  const srcdoc = useMemo(() => buildCardSrcdoc(html), [html]);

  // 变量变化 → 通知卡片 iframe 重绘（MVU技术性说明 §4.6：状态栏 View 靠
  // eventOn(Mvu.events.VARIABLE_UPDATE_ENDED) 自动重绘；事件名取自 Mvu.events，值即
  // `mag_variable_update_ended`）。没有这一步，面板只会显示 iframe 加载那一刻的初始快照
  // （真机实测：JSONPatch 已把时间改成 07:10，面板仍停在 07:00）。
  const frameRef = React.useRef<HTMLIFrameElement | null>(null);
  const dispatchVariableUpdateEnded = useCallback(() => {
    try {
      const win = frameRef.current?.contentWindow as unknown as
        | { __nyaCardDispatch?: (...args: unknown[]) => void }
        | undefined;
      win?.__nyaCardDispatch?.("mag_variable_update_ended", {});
    } catch {
      /* 卡片未就绪或已卸载：忽略 */
    }
  }, []);
  React.useEffect(
    () => subscribeVariables(dispatchVariableUpdateEnded),
    [dispatchVariableUpdateEnded],
  );

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
          id={frameId}
          ref={frameRef}
          title={frameId}
          srcDoc={srcdoc}
          loading="lazy"
          onLoad={dispatchVariableUpdateEnded}
          className="w-full block border-0 bg-transparent"
          // Same-origin, NOT sandboxed — required for the height sync
          // (the card reads window.frameElement). See srcdoc.ts.
          style={{ height: 60, minHeight: 60, background: "transparent" }}
        />
      )}
    </div>
  );
});
