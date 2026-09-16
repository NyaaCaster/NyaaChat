/**
 * 当前载体实现：**同源、无 sandbox 的隐藏 srcdoc iframe**（SSOT §2.4 / §5.1，D5①）。
 *
 * 装配顺序（t1 实测约束）：`base` → `importmap` → 依次加载全局库
 * （lodash → jquery → toastr 为 classic；yaml / zod 为生成的最小 ESM 包装，必须
 * `import()`）→ 预置脚本 → 逐个执行用户脚本 → MVU 握手。
 *
 * 错误可见性（用户要求的"扩展报错要能追踪"在本层的落点）：
 * iframe 内的未捕获错误**不会**传播到宿主窗口，因此这里在**父窗口**订阅
 * `contentWindow` 的 `error` 与 `unhandledrejection`，把它们记到 `pluginLog`
 * 并带上脚本名 —— 否则卡片脚本失败时用户只能手动切 devtools context 才看得到。
 */
import { pluginLogger } from "../../../src/plugins/pluginLog";
import type { ScriptRecord } from "../../../src/types";
import { buildPredefineScript } from "./predefine";
import type { ScriptHost, ScriptHostHandle, ScriptHostMountArgs } from "./host";
import { loadVendorImportMap } from "../vendor";

const PLUGIN_ID = "js-slash-runner";
const SCRIPT_TIMEOUT_MS = 15_000;

/** 宿主窗口上的桥：iframe 同源，直接读它拿门面对象。 */
interface ScriptHostBridge {
  api: ScriptHostMountArgs["api"];
  args: { scripts: ScriptRecord[]; globals: Array<{ path: string; esm: boolean }> };
  onScriptResult: (scriptId: string, ok: boolean, error?: string) => void;
}

declare global {
  interface Window {
    __nyaScriptHostBridge?: ScriptHostBridge;
    __nyaDispatch?: (name: string, payload?: unknown) => void;
    __nyaSyncMvu?: () => boolean;
  }
}

/** 生成 iframe 内的装配脚本（classic 脚本里用 `import()` 加载 ESM 包装）。 */
function buildBootstrapScript(bridge: ScriptHostBridge, importMap: Record<string, string>): string {
  const payload = JSON.stringify({
    globals: bridge.args.globals,
    scripts: bridge.args.scripts.map((s) => ({ id: s.id, name: s.name, content: s.content })),
    timeoutMs: SCRIPT_TIMEOUT_MS,
  });
  return `
(function () {
  var data = ${payload};
  function loadClassic(src) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement('script');
      el.src = src;
      el.onload = function () { resolve(); };
      el.onerror = function () { reject(new Error('加载失败: ' + src)); };
      document.head.appendChild(el);
    });
  }
  function runOne(script) {
    return new Promise(function (resolve) {
      var el = document.createElement('script');
      el.type = 'module';
      el.textContent =
        'window.__nyaScriptId = ' + JSON.stringify(script.id) + ';\\n' + script.content;
      var done = false;
      function finish(ok, error) {
        if (done) return;
        done = true;
        try { window.parent.__nyaScriptHostBridge.onScriptResult(script.id, ok, error); } catch (e) {}
        resolve();
      }
      el.onload = function () { finish(true); };
      el.onerror = function () { finish(false, '模块加载或求值失败'); };
      document.head.appendChild(el);
      // 超时是最常见的"静默失败"形态：把最近调用过的宿主 API 一并报出来，
      // 这样用户在扩展面板里就能看到脚本停在哪一步（不需要 devtools）。
      setTimeout(function () {
        var detail = '执行超时';
        try {
          var calls = (window.__nyaApiCalls || []).slice(-10);
          detail += '；最近宿主 API 调用=' + JSON.stringify(calls);
          // 超时那一刻的两个关键事实：MVU 的设置 store 有没有建起来（should_enable 在
          // 里面）、以及父窗口/Mvu 全局是否存在。
          try {
            var ext = window.SillyTavern ? window.SillyTavern.extensionSettings : null;
            var mvuSettings = ext && ext.mvu_settings ? ext.mvu_settings : null;
            detail += '；mvu_settings=' + JSON.stringify(mvuSettings).slice(0, 300);
            detail += '；Mvu=' + (typeof window.Mvu !== 'undefined' && window.Mvu ? 'object' : String(window.Mvu));
          } catch (e) {}
        } catch (e) { /* 探针读取失败不影响超时报错 */ }
        // ⚠️ 超时不等于失败：JSR 脚本常以顶层 await 长驻（MVU 就是事件驱动的长驻脚本）。
        // 只要**已证明执行过**（产生过宿主 API 调用），就判为"已启动并持续运行"，
        // 否则功能正常时也会一直刷红字（用户真机反馈）。
        var started = false;
        try { started = (window.__nyaApiCalls || []).length > 0; } catch (e) {}
        if (started) {
          try { console.info('[js-slash-runner] 脚本已启动并持续运行（模块未结束属正常）：' + detail); } catch (e) {}
          finish(true);
        } else {
          finish(false, detail);
        }
      }, data.timeoutMs);
    });
  }
  async function main() {
    // probe 先装、库后载：这样库加载期的 console 也被记进环形缓冲（用户只需一条命令看全貌）。
    try { if (window.__nyaInstallProbes) window.__nyaInstallProbes(); } catch (e) {}
    try { console.info('[js-slash-runner] 宿主脚本构建 v12-2800'); } catch (e) {}
    // F3（t7 实测）：逐库容错 —— 五个库原先共用一个 try，任一个失败（典型：
    // 后缀为 mjs 的库被 nosniff 以 application/octet-stream 拒掉）就会整轮中止、
    // 所有脚本都不跑。改为单库失败只记一条并继续；全部结束后若有失败库，汇总一条
    // warn 说明"相关脚本可能 ReferenceError"，但**仍然执行脚本**（让用户看到真正的
    // 脚本报错，而不是被库加载静默吞掉）。
    // ⚠️ 本段在模板字符串内：注释里**不得出现反引号**（会提前终止外层模板）。
    var failedLibs = [];
    for (var i = 0; i < data.globals.length; i++) {
      var g = data.globals[i];
      try {
        if (g.esm) {
          var mod = await import(g.path);
          if (g.globalName) window[g.globalName] = mod;
        } else {
          await loadClassic(g.path);
        }
      } catch (err) {
        failedLibs.push(g.path);
        console.error('[js-slash-runner] 运行时库加载失败（继续加载其余库）: ' + g.path, err);
      }
    }
    if (failedLibs.length) {
      console.warn(
        '[js-slash-runner] 以下运行时库未能加载，依赖它们的脚本会报 ReferenceError：' +
          failedLibs.join(', ')
      );
    }
    try { window.__nyaSyncMvu(); } catch (e) {}
    // 再装一次探针：toastr 是**库加载之后**才存在的，装早了它的调用记录永远是空数组
    // （v11-1542 真机就是这样，导致"分支①会弹 toast"这条旁证拿不到）。
    try { if (window.__nyaInstallProbes) window.__nyaInstallProbes(); } catch (e) {}
    // app_ready：MVU 的初始化链会 await 宿主的"就绪"事件（JSR 会发 APP_READY）。
    // ⚠️ 时序很关键：必须在**脚本已开始求值之后**发（脚本在求值期同步 eventOn 注册监听），
    // 但又**不能**等全部脚本 load（若某脚本 await 这个事件，等它完成就是死锁）⇒ 用
    // setTimeout(0) 在脚本刚起步时派发。
    setTimeout(function () {
      try { window.__nyaDispatch(window.tavern_events.APP_READY, {}); } catch (e) {}
    }, 0);
    // JSR 兼容：MVU 判定"当前启用的脚本"靠查询 #tavern_helper 内的 div[data-script-id]，
    // 再与 window.parent 上的 th_unique_check.<扩展名> 集合取交集（源码级定位）。
    // JSR 由它的脚本列表 DOM 提供这些节点，我们没有 ⇒ 偏好状态永远取不到值
    // ⇒ MVU 永不发布 Mvu ⇒ mvu_zod 永久等 waitGlobalInitialized。补上同构的隐藏节点。
    try {
      var helperRoot = document.createElement('div');
      helperRoot.id = 'tavern_helper';
      helperRoot.style.display = 'none';
      for (var si = 0; si < data.scripts.length; si++) {
        var scriptNode = document.createElement('div');
        scriptNode.setAttribute('data-script-id', data.scripts[si].id);
        helperRoot.appendChild(scriptNode);
      }
      document.body.appendChild(helperRoot);
    } catch (e) { console.error('[js-slash-runner] 构建 #tavern_helper 失败，MVU 偏好状态可能取不到值', e); }
    for (var j = 0; j < data.scripts.length; j++) {
      // S-d 探针：记下"每个脚本执行期间 getScriptId() 读到了什么"。判据是
      // reads 里**只**出现该脚本自己的 id —— 出现别人的 id 就说明模块局部变量方案不够用。
      var readsBefore = (window.__nyaScriptIdReads || []).length;
      await runOne(data.scripts[j]);
      try {
        var readsAfter = (window.__nyaScriptIdReads || []).slice(readsBefore);
        var trace = window.__nyaScriptIdTrace;
        if (!trace) { trace = []; window.__nyaScriptIdTrace = trace; }
        trace.push({ id: data.scripts[j].id, name: data.scripts[j].name, reads: readsAfter });
      } catch (e) { /* 探针失败不影响脚本执行 */ }
      try { if (window.__nyaSyncMvu) window.__nyaSyncMvu(); } catch (e) {}
    }
    // 脚本跑完后补发一次"当前会话/角色"状态：这些事件在宿主侧可能早于本 iframe 存在
    // （iframe 是 mount 时才创建的）⇒ 晚注册的脚本会永久等一个"已经过去"的事件。
    setTimeout(function () {
      try {
        // ⚠️ CHAT_CHANGED 的载荷必须是**当前聊天 id 字符串**，且与 SillyTavern.getCurrentChatId()
        //    同源同值：MVU 的初始化谓词是 getCurrentChatId() === e，给对象会让它判假并**回滚
        //    全部事件处理器**（真机 v12-1707：message_received 派发到了 iframe 但 handlers:0）。
        window.__nyaDispatch(window.tavern_events.CHAT_CHANGED, window.__nyaChatId ? window.__nyaChatId() : 'nyaachat-unsaved');
        window.__nyaDispatch(window.tavern_events.CHARACTER_CHANGED, {});
      } catch (e) {}
    }, 0);
  }
  void main();
})();
`;
}

function buildSrcdoc(bridge: ScriptHostBridge, importMap: Record<string, string>): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const importMapTag = `<script type="importmap">${JSON.stringify({ imports: importMap })}</script>`;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
${origin ? `<base href="${origin}/">` : ""}
${importMapTag}
</head>
<body>
<script>window.__nyaDispatchCalls = [];</script>
<script>${buildPredefineScript()}</script>
<script>${buildBootstrapScript(bridge, importMap)}</script>
</body>
</html>`;
}

export function createSrcdocScriptHost(): ScriptHost {
  return {
    kind: "srcdoc",
    async mount(args: ScriptHostMountArgs): Promise<ScriptHostHandle> {
      const log = pluginLogger(PLUGIN_ID);
      const iframe = document.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      iframe.setAttribute("data-js-slash-runner-host", "1");
      // 隐藏但仍参与脚本执行：`display:none` 会让某些布局相关脚本失效，
      // 用 1×1 + 不可见定位更温和。
      iframe.style.cssText =
        "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;border:0;left:-9999px;";
      // ⚠️ 刻意**不加** sandbox：同源是 `window.parent.__nyaScriptHostBridge`
      // 直连与高度/全局共享的前提（D5①，security notice 已在设置面板告知）。
      args.container.appendChild(iframe);

      const importMap = await loadVendorImportMap(args.api.vendor.manifestUrl);
      const bridge: ScriptHostBridge = {
        api: args.api,
        args: { scripts: args.runOnLoad ? args.scripts : [], globals: args.api.vendor.globals },
        onScriptResult: (scriptId, ok, error) => {
          const script = args.scripts.find((s) => s.id === scriptId);
          if (ok) {
            log.info("script", `脚本「${script?.name ?? scriptId}」执行完成`);
          } else {
            log.error("script", `脚本「${script?.name ?? scriptId}」${error ?? "执行失败"}`);
          }
          args.onScriptResult?.(scriptId, ok, error);
        },
      };
      window.__nyaScriptHostBridge = bridge;

      const onError = (event: ErrorEvent | Event) => {
        const detail =
          event instanceof ErrorEvent
            ? `${event.message} @ ${event.filename}:${event.lineno}`
            : "未知错误";
        log.error("iframe", `卡片脚本未捕获错误：${detail}`, (event as ErrorEvent)?.error);
      };
      const onRejection = (event: PromiseRejectionEvent) => {
        log.error("iframe", "卡片脚本未处理的 Promise 拒绝", event?.reason);
      };

      const win = iframe.contentWindow;
      win?.addEventListener("error", onError as EventListener);
      win?.addEventListener("unhandledrejection", onRejection as EventListener);

      iframe.srcdoc = buildSrcdoc(bridge, importMap);

      let alive = true;
      const teardown = () => {
        if (!alive) return;
        alive = false;
        try {
          win?.removeEventListener("error", onError as EventListener);
          win?.removeEventListener("unhandledrejection", onRejection as EventListener);
        } catch {
          /* iframe 已经被移除 */
        }
        iframe.remove();
        if (window.__nyaScriptHostBridge === bridge) delete window.__nyaScriptHostBridge;
      };

      return {
        // 酒馆语义：`emit(event, ...args)` —— 多参数事件（MVU 的 VARIABLE_INITIALIZED 等）
        // 必须原样转发，否则 iframe 内处理器拿到 undefined（真机 v12-1753 实测报错）。
        emit(tavernEventValue: string, ...args: unknown[]) {
          if (!alive) return;
          try {
            iframe.contentWindow?.__nyaDispatch?.(tavernEventValue, ...args);
          } catch (err) {
            log.warn("emit", `派发事件 ${tavernEventValue} 失败`, err);
          }
        },
        dispose: teardown,
        isAlive: () => alive,
      } satisfies ScriptHostHandle;
    },
  };
}
