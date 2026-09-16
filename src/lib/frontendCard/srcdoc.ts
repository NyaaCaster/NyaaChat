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

import { getCardApiPredefine } from "../../plugins/scriptHost";

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
 *
 * `predefine` = 卡片 iframe 的宿主 API 注入（D14）：MVU 的 View（状态栏）在**卡片
 * iframe 内**调用 `getAllVariables()`，所以那里也要有一份只读变量 API。缺省时从叶子
 * `src/plugins/scriptHost` 读（插件启用时它才非空）⇒ **插件未启用时本函数输出与改造前
 * 逐字节相同**（无注入 ⇒ 不插入任何 `<script>`，只有 HEIGHT_SCRIPT）。
 */
export function buildCardSrcdoc(html: string, predefine?: string | null): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const injected = predefine === undefined ? getCardApiPredefine() : predefine;
  // 卡片 iframe 还需要 **vendor 全局**（#3 真机帧级定性：卡片自己的引导脚本调用
  // `$(errorCatched(init))`，而 D14 原先只注入变量 API ⇒ `ReferenceError: $ is not defined`）。
  // ⚠️ 必须用 **classic `<script src>`** 且置于卡片 html **之前**：classic 脚本同步执行，
  // 卡片内联脚本运行时 `$`/`_` 已就绪（若改成动态插入或 module 加载就来不及）。
  // 插件未启用（injected 为空）时**不插入任何东西** ⇒ 输出与改造前逐字节一致。
  const vendorTags = injected
    ? `<script src="/vendor/script-host/lodash.min.js"></script>
<script src="/vendor/script-host/jquery.min.js"></script>
`
    : "";
  const predefineTag = injected ? `${vendorTags}<script>${injected}</script>\n` : "";
  // ⚠️ **卡片自带完整文档时绝不嵌套包裹**：内层 <!DOCTYPE>/<html>/<head>/<body> 落在
  // 外层 <body> 里全是非法标签，浏览器会把 <style> 内容与标签本身当文本吐出来
  // （真机复现：状态栏卡片的 CSS 漏在气泡里）。此时改为把注入插进这份文档自身：
  // 预置脚本插在 <head> 之后，高度自适应脚本插在 </body> 之前。
  const isFullDocument = /^\s*<!DOCTYPE/i.test(html) || /^\s*<html[\s>]/i.test(html);
  if (isFullDocument) {
    let out = html;
    if (predefineTag) {
      out = /<head[^>]*>/i.test(out)
        ? out.replace(/<head[^>]*>/i, (m) => `${m}\n${predefineTag}`)
        : `${predefineTag}${out}`;
    }
    out = /<\/body>/i.test(out)
      ? out.replace(/<\/body>/i, `<script>${HEIGHT_SCRIPT}</script>\n</body>`)
      : `${out}\n<script>${HEIGHT_SCRIPT}</script>`;
    return out;
  }
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
${predefineTag}${html}
<script>${HEIGHT_SCRIPT}</script>
</body>
</html>`;
}
