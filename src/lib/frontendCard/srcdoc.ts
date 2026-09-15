// 前端卡的 iframe 文档装配。
//
// 围绕卡片标记拼出完整 srcdoc 文档，只做两件事：
//   (a) 用 <base> 让卡片里的相对 URL 能对上宿主 origin；
//   (b) 自动把 iframe 高度撑到内容高度（同源才能做到，见下）。
//
// 这里**不再向卡片预置任何宿主 API**：卡片只拿到自己的文档，没有现成的 NyaaChat
// 全局可抓。
//
// SECURITY NOTE: iframe 保持同源且不加 sandbox —— 这是高度自适应（卡片内侧读
// window.frameElement 写 style.height）的前提。同源意味着卡片脚本技术上仍能顺着
// 父窗口访问宿主文档，所以本模块**不是**安全边界，只是不再主动提供宿主 API。
// 结论不变：只渲染你信任来源的卡片，不要拿这条通道渲染任意的、不可信 HTML。

/** 高度自适应脚本。在 <body> 上挂 ResizeObserver，把量到的高度直接写回
 *  frameElement.style.height —— 只有同源 iframe 才允许这么做。rAF 节流。 */
const HEIGHT_SCRIPT = `
(function () {
  var scheduled = false;
  function measure() {
    scheduled = false;
    try {
      var h = document.body ? document.body.scrollHeight : 0;
      if (!isFinite(h) || h <= 0) return;
      if (window.frameElement) window.frameElement.style.height = h + 'px';
    } catch (e) {}
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(measure);
    else setTimeout(measure, 100);
  }
  function start() {
    schedule();
    try {
      if (document.body && typeof ResizeObserver === 'function') {
        new ResizeObserver(schedule).observe(document.body);
      }
    } catch (e) {}
    window.addEventListener('load', schedule);
    // Re-measure once images/fonts settle.
    setTimeout(schedule, 300);
    setTimeout(schedule, 1000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
`;

/**
 * Build the full srcdoc document for a card. `origin` lets relative URLs in the
 * card resolve against the host origin (via the <base> tag).
 */
export function buildCardSrcdoc(html: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${origin ? `<base href="${origin}/">` : ""}
<style>
*,*::before,*::after{box-sizing:border-box;}
html,body{margin:0;padding:0;max-width:100%;background:transparent;}
body{overflow:hidden;}
</style>
</head>
<body>
${html}
<script>${HEIGHT_SCRIPT}</script>
</body>
</html>`;
}
