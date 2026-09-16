/**
 * 脚本运行器（JS-Slash-Runner）—— NyaaChat 原生插件（SSOT §0.1 / §2.4）。
 *
 * 职责：① 把角色卡自带的 JS 脚本在**隐藏同源 iframe** 里跑起来（`executor/`）；
 * ② 把 MVU 需要的 TavernHelper 兼容 API 子集桥进去（宿主实现见
 * `src/plugins/scriptHostImpl.ts`）；③ 脚本库 UI（列表/启停/排序/导入，UI 组件由
 * t4 交付）；④ 把宿主事件派发进 iframe（`tavern_events` 值）；⑤ 卡片 iframe 的
 * `getAllVariables()` 注入（D14）。
 *
 * 本文件**只** import 叶子模块（`src/plugins/{scriptHost,pluginLog,types}`）与自己的
 * 子模块 —— 不碰 `runtime`/`registry`/`backend`（会构成模块环，见 `hostContext.ts`）。
 */
import { useSyncExternalStore } from "react";
import { pluginLogger } from "../../src/plugins/pluginLog";
import { getScriptHostApi, setCardApiPredefine, setScriptInitBusy } from "../../src/plugins/scriptHost";
import type { NyaaPlugin, PluginSettingsPanelProps } from "../../src/plugins/types";
import type { ScriptRecord } from "../../src/types";
import { buildCardPredefineScript, HOST_TO_TAVERN_EVENT, TAVERN_EVENTS } from "./executor/predefine";
import { createScriptHost, type ScriptHostHandle } from "./executor/host";
import ScriptLibraryModal from "./ScriptLibraryModal";
import ScriptRunnerSettings, { type ScriptRunError } from "./ScriptRunnerSettings";
import { nextScriptId, parseScriptsFile } from "./scripts/store";

export const JS_SLASH_RUNNER_PLUGIN_ID = "js-slash-runner";
/** 初始化忙碌窗口上限：≤5s（脚本自身超时是 30s，绝不能让"脚本可能挂住"变成"用户被锁住"）。 */
const INIT_BUSY_MAX_MS = 20000;
/** 构建标记：在主页面控制台输入 __nyaScriptRunnerBuild 即可确认当前跑的是哪个构建。 */
const BUILD_MARKER = 'v12-1753';
const log = pluginLogger(JS_SLASH_RUNNER_PLUGIN_ID);

// ─── 模块级状态（面板与 setup 共享；插件是单例）─────────────────────────────
/** 最近一次脚本错误（面板显示用）。 */
let lastError: ScriptRunError | null = null;
const errorListeners = new Set<() => void>();
function setLastError(next: ScriptRunError | null): void {
  lastError = next;
  for (const listener of [...errorListeners]) {
    try {
      listener();
    } catch (err) {
      console.error("[js-slash-runner] 错误订阅者抛错", err);
    }
  }
}
function subscribeLastError(listener: () => void): () => void {
  errorListeners.add(listener);
  return () => {
    errorListeners.delete(listener);
  };
}

/** setup 注册的重挂载钩子（脚本集合变化时用）。 */
let requestRemount: (() => void) | null = null;
/** 脚本库弹窗开关（面板里的入口按钮触发）。 */
let libraryOpen = false;
const libraryListeners = new Set<() => void>();
function setLibraryOpen(next: boolean): void {
  libraryOpen = next;
  for (const listener of [...libraryListeners]) listener();
}
function subscribeLibrary(listener: () => void): () => void {
  libraryListeners.add(listener);
  return () => {
    libraryListeners.delete(listener);
  };
}

function currentScripts(): ScriptRecord[] {
  return getScriptHostApi()?.character.getScripts() ?? [];
}

/** 用文件里的脚本替换当前角色的脚本集合（保留顺序语义：追加到末尾）。 */
export function importScriptsFromText(text: string): void {
  const api = getScriptHostApi();
  if (!api) throw new Error("宿主尚未就绪，无法导入脚本");
  const existing = api.character.getScripts();
  const imported = parseScriptsFile(text, existing);
  api.character.setScripts([...existing, ...imported]);
  requestRemount?.();
  log.info("library", `从文件导入 ${imported.length} 个脚本`);
}

// ─── 设置面板：把插件内部状态注入 t4 交付的纯展示组件 ──────────────────────
function SettingsPanel(props: PluginSettingsPanelProps) {
  const scripts = currentScripts();
  const recentError = useSyncExternalStore(subscribeLastError, () => lastError);
  return (
    <>
      <ScriptRunnerSettings
        {...props}
        scripts={scripts}
        onScriptsChange={(next: ScriptRecord[]) => {
          getScriptHostApi()?.character.setScripts(next);
          requestRemount?.();
        }}
        onImportScripts={() => setLibraryOpen(true)}
        recentError={recentError}
      />
      <ScriptLibraryModalBridge
        scripts={scripts}
        onChange={(next: ScriptRecord[]) => {
          getScriptHostApi()?.character.setScripts(next);
          requestRemount?.();
        }}
      />
    </>
  );
}

/** 弹窗的受控桥：订阅模块级开关，避免给 SettingsPanel 增加状态。 */
function ScriptLibraryModalBridge(props: {
  scripts: ScriptRecord[];
  onChange: (next: ScriptRecord[]) => void;
}) {
  // 模块级状态必须经 useSyncExternalStore 订阅，否则 setLibraryOpen 不会触发重渲。
  const open = useSyncExternalStore(subscribeLibrary, () => libraryOpen);
  return (
    <ScriptLibraryModal
      open={open}
      scripts={props.scripts}
      onChange={props.onChange}
      onImport={() => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.onchange = () => {
          const file = input.files?.[0];
          if (!file) return;
          void file.text().then(
            (text) => {
              try {
                importScriptsFromText(text);
              } catch (err) {
                setLastError({
                  scriptName: file.name,
                  message: err instanceof Error ? err.message : String(err),
                  at: Date.now(),
                });
                log.error("library", `导入脚本文件失败：${file.name}`, err);
              }
            },
            (err) => log.error("library", "读取脚本文件失败", err),
          );
        };
        input.click();
      }}
      onClose={() => setLibraryOpen(false)}
    />
  );
}

const plugin: NyaaPlugin = {
  meta: {
    id: JS_SLASH_RUNNER_PLUGIN_ID,
    name: "脚本运行器",
    description:
      "在隐藏同源沙箱中运行角色卡自带的 JS 脚本（兼容酒馆助手 JS-Slash-Runner 的 API 子集与 tavern_events），让基于 MVU 的变量脚本可用。脚本与角色卡一同导入导出。",
    version: "1.0.0",
    author: "Nyaa",
    icon: "FileCode2",
    order: 10,
  },
  defaults: { runOnLoad: true },
  setup: (ctx) => {
    // 可查的构建标记（主页面全局）：确认"当前跑的构建"不再靠猜。
    try {
      (window as unknown as Record<string, unknown>).__nyaScriptRunnerBuild = BUILD_MARKER;
      console.info('[js-slash-runner] 插件已启用，构建 ' + BUILD_MARKER);
    } catch { /* 标记失败不影响功能 */ }

    const api = getScriptHostApi();
    if (!api) {
      log.error("setup", "宿主门面未注册（App 未挂载？），脚本不会运行");
      return;
    }

    setCardApiPredefine(buildCardPredefineScript());

    const container = document.createElement("div");
    container.setAttribute("data-js-slash-runner-container", "1");
    container.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;";
    document.body.appendChild(container);

    let handle: ScriptHostHandle | null = null;
    let disposed = false;
    let mounting = false;
    // 初始化忙碌窗口：起点 = 开始装配；终点 = 第一个脚本给出结果 / 5s 上限 / 停用。
    // ⚠️ 上限刻意只有 5s（脚本本身的超时是 30s）：绝不能让"脚本可能挂住"变成
    // "用户被锁 30 秒"。到点就放行，失败信息仍留在运行日志里。
    // 非模态提示（一行、固定底部居中）：不拦点击、不遮内容，只告知"脚本正在初始化"。
    // 刻意用命令式 DOM 而不是改聊天输入区的 JSX —— 既不动别人的组件结构，也不会
    // 因为渲染时机错过这段窗口。
    const notice = document.createElement("div");
    notice.textContent = "正在初始化角色脚本…";
    notice.style.cssText =
      "position:fixed;left:50%;bottom:88px;transform:translateX(-50%);z-index:40;" +
      "padding:6px 12px;border-radius:9999px;background:rgba(0,0,0,.72);color:#fff;" +
      "font-size:12px;line-height:1.4;pointer-events:none;opacity:0;transition:opacity .15s;";
    document.body.appendChild(notice);
    const setNotice = (on: boolean) => {
      notice.style.opacity = on ? "1" : "0";
    };

    let busyTimer: ReturnType<typeof setTimeout> | null = null;
    const endBusy = () => {
      if (busyTimer) {
        clearTimeout(busyTimer);
        busyTimer = null;
      }
      setScriptInitBusy(false);
      setNotice(false);
    };
    const beginBusy = () => {
      setScriptInitBusy(true);
      setNotice(true);
      if (busyTimer) clearTimeout(busyTimer);
      busyTimer = setTimeout(() => {
        busyTimer = null;
        setScriptInitBusy(false);
        setNotice(false);
      }, INIT_BUSY_MAX_MS);
    };

    const mount = async () => {
      if (disposed || mounting) return;
      // ⚠️ mounting 必须在**等待之前**置位：等就绪可能耗时数秒，其间 session:changed /
      // character:changed 会再触发一次 mount，两个等待同时通过就会各自建一个宿主 iframe
      // （MVU 被初始化两次）。置位后走到 finally 再复位。
      mounting = true;
      try {
        // ⚠️ 等宿主聊天状态就绪再装配：MVU 的 initvar（bundle 内 `Zt`）只有两个**静默**退出点，
        // 且都只打同一句 runtime.initvar.noMessagesLog（真机原文「不存在任何一条消息，退出」），
        // 之后不再重试 ⇒ 变量初始化与楼层改写都不发生（现象：每轮回复没有状态栏）：
        //   ① `0 === SillyTavern.chat.length`（紧跟一句 toastr.error）
        //   ② 该 try 块内抛错（catch **丢弃了错误对象**，devtools 里看不到原因）
        // 就绪判据必须是「会话已解析 **且**已有楼层」（见 scriptHostImpl.messagesApi.chatReady）：
        // 只看"适配器已注册"会在应用启动期立刻放行——那一刻 currentSessionId 可能还是 null，
        // getAll() 返回 []，MVU 就会读到空聊天（v10-1600 仍报 noMessagesLog 的**头号候选**根因；
        // 本次同时把两个分支的可观测证据交给 __nyaScriptRunnerDiag()，不再靠推断）。
        for (let i = 0; i < 40 && !disposed && !api.messages.chatReady(); i++) {
          await new Promise((r) => setTimeout(r, 150));
        }
        if (disposed) return;
        if (!api.messages.chatReady()) {
          const snap = snapshot();
          log.warn("host", "等待聊天就绪超时（6s），仍按当前状态装配；MVU 若读到空聊天会退出变量初始化", snap);
          dumpProbe("等待聊天就绪超时（6s）", snap);
        }
        handle?.dispose();
        handle = null;
        const runOnLoad = ctx.getConfig().runOnLoad !== false;
        const scripts = api.character.getScripts().filter((s) => s.enabled);
        // 没有启用的脚本 ⇒ 根本不需要初始化窗口（大多数用户看不到任何变化）。
        if (scripts.length > 0 && runOnLoad) beginBusy();
        handle = await createScriptHost().mount({
          container,
          scripts,
          api,
          runOnLoad,
          onScriptResult: (scriptId, ok, error) => {
            // 第一个脚本落地即解除忙碌窗口（成功或失败都解除：失败信息在运行日志里）。
            endBusy();
            if (ok) return;
            const script = scripts.find((s) => s.id === scriptId);
            setLastError({
              scriptName: script?.name ?? scriptId,
              message: error ?? "脚本执行失败",
              at: Date.now(),
            });
          },
        });
        log.info("host", `脚本宿主已装配（${scripts.length} 个脚本${runOnLoad ? "" : "，未执行"}）`);
      } catch (err) {
        log.error("host", "装配脚本宿主失败", err);
      } finally {
        mounting = false;
      }
    };

    // 脚本宿主 iframe 内的探针（同源，直接读；见 executor/predefine.ts 的 __nyaShellProbe /
    // __nyaScriptConsole / __nyaToastrCalls / __nyaApiCalls）。用来把 MVU initvar 的静默退出
    // 分成两支：分支① chat.length===0（会同时弹 toastr）、分支② try 内抛错（错误被 MVU 丢弃）。
    const readIframeProbe = () => {
      const frame = document.querySelector<HTMLIFrameElement>("iframe[data-js-slash-runner-host]");
      const w = frame?.contentWindow as unknown as Record<string, unknown> | undefined;
      if (!w) return null;
      const tail = (key: string, n: number) => {
        const arr = w[key];
        return Array.isArray(arr) ? (arr as unknown[]).slice(-n) : [];
      };
      // 变量相关调用单独取**最早**的一批（`__nyaApiCalls` 是 200 条环形，早期的初始化
      // 序列最容易被后续调用挤掉，但恰恰是"写没写"的关键证据）。
      const varCalls = (() => {
        const arr = w.__nyaApiCalls;
        if (!Array.isArray(arr)) return [];
        return arr
          .filter((c) =>
            /Variables|ChatMessages|LastMessageId|Lorebook|eventEmit/i.test(String((c as { n?: unknown })?.n ?? "")),
          )
          .slice(0, 40);
      })();
      return {
        shell: w.__nyaShellProbe ?? null,
        console: tail("__nyaScriptConsole", 12),
        toastr: tail("__nyaToastrCalls", 8),
        apiCalls: tail("__nyaApiCalls", 12),
        varCalls,
      };
    };

    // MVU 的变量初始化（bundle 内 `Jt`）只认 comment 里含 `[initvar]` 的世界书条目：
    //   n = [...getLorebookSettings().selected_global_lorebooks, ...getCharLorebooks().primary/additional]
    //   逐个 getLorebookEntries(name)，命中 comment 含 `[initvar]`（不分大小写）才返回 true。
    // 这里把这条**前置条件链**原样打印出来，避免再靠推断。
    const lorebookProbe = () => {
      try {
        const settings = api.lorebook.getSettings() as unknown as Record<string, unknown>;
        const charBooks = api.lorebook.getCharLorebooks();
        const globalBooks = Array.isArray(settings.selected_global_lorebooks)
          ? (settings.selected_global_lorebooks as string[])
          : [];
        const entries = api.lorebook.getEntries(charBooks.primary ?? "");
        return {
          globalBooks,
          primary: charBooks.primary,
          additional: charBooks.additional,
          entryCount: entries.length,
          initvarEntries: entries
            .filter((e) => /\[initvar\]/i.test(String(e.comment ?? "")))
            .map((e) => e.comment),
          entryNames: entries.slice(0, 12).map((e) => e.comment),
        };
      } catch (err) {
        return { error: String(err) };
      }
    };

    // 主页面可直接打印的诊断：控制台输入 __nyaScriptRunnerDiag()
    // ⚠️ 同时打一行 **JSON 字符串**：dev 的 console 收集器会把嵌套对象截断成 {…}
    //（真机贴回来的日志里 `iframes: 1, …` 就是被截断的），JSON 一行才能完整回贴。
    const dumpProbe = (label: string, s: unknown) => {
      console.warn(`[js-slash-runner] ${label}`, s);
      try {
        console.warn(`[js-slash-runner] ${label}JSON ` + JSON.stringify(s));
      } catch {
        console.warn(`[js-slash-runner] ${label}JSON (序列化失败)`);
      }
    };
    const snapshot = () => ({
      build: BUILD_MARKER,
      chatReady: api.messages.chatReady(),
      messages: api.messages.getAll().length,
      withVariables: api.messages
        .getAll()
        .filter((m) => Array.isArray(m.variables) && m.variables[0] && Object.keys(m.variables[0]).length > 0)
        .length,
      character: api.character.getName(),
      scripts: api.character.getScripts().length,
      identity: api.identity,
      iframes: document.querySelectorAll("iframe[data-js-slash-runner-host]").length,
      messagesDiag: api.messages.diagnostics(),
      // MVU 的 `At(e)`/`Ct(e)` 前置条件：一个楼层要被认作"变量楼层"，`variables[swipe]` 里必须
      // **同时**有 stat_data 与 schema（bundle 内 Ct 的判定原文）。缺任一个，MVU 的收尾路径
      // （负责追加状态栏占位符的 Yt）就会静默早退。这里逐楼层把实际键列出来。
      floors: api.messages.getAll().map((m, i) => {
        const slot = (Array.isArray(m.variables) ? m.variables[0] : undefined) as
          | Record<string, unknown>
          | undefined;
        return {
          i,
          role: m.role,
          keys: slot ? Object.keys(slot) : [],
          sd: !!slot?.stat_data,
          sc: !!slot?.schema,
          // 正文尾部：MVU 追加状态栏占位符改的就是正文 —— 用它判断"追加有没有落到消息上"。
          hasPh: typeof m.content === "string" && m.content.indexOf("StatusPlaceHolderImpl") >= 0,
          tail: typeof m.content === "string" ? m.content.slice(-50) : null,
        };
      }),
      lorebook: lorebookProbe(),
      varTrace: (() => {
        const w = window as unknown as { __nyaVarTrace?: unknown[] };
        return Array.isArray(w.__nyaVarTrace) ? w.__nyaVarTrace.slice(-25) : [];
      })(),
      // 宿主显示侧正则链摘要（由 ChatInterface 挂到 window）：回答"卡片正则被导入成什么样了"，
      // 尤其 `[美化]变量完成-三明月喵` 的替换串长度（卡片里是 3624 字符）。
      regexChain: (window as unknown as { __nyaRegexChain?: unknown }).__nyaRegexChain ?? null,
      iframe: readIframeProbe(),
    });
    (window as unknown as Record<string, unknown>).__nyaScriptRunnerDiag = () => {
      const s = snapshot();
      dumpProbe("诊断快照", s);
      return s;
    };
    // 装配**之前**的快照是判定"就绪竞态"的关键证据：若这里 chatReady 为 true 而 messages 为 0，
    // 就说明门面把"适配器已注册"误当成了"聊天已就绪"（v10-1600 的 noMessagesLog 根因候选）。
    dumpProbe("mount 前快照", snapshot());

    requestRemount = () => void mount();
    void mount();

    // 宿主事件 → iframe（只派发有对应 tavern_events 常量的那几个）。
    const offs: Array<() => void> = [];
    for (const [hostEvent, tavernKey] of Object.entries(HOST_TO_TAVERN_EVENT)) {
      const tavernValue = TAVERN_EVENTS[tavernKey];
      if (!tavernValue) continue;
      offs.push(
        ctx.on(hostEvent as Parameters<typeof ctx.on>[0], (payload) => {
          // ⚠️ JSR/ST 的 MESSAGE_SENT / MESSAGE_RECEIVED 载荷是**楼层下标**（number）。
          // MVU 直接把事件参数当 message_id 用：`jo(e)` → `getChatMessages(e)`、
          // `Yt(e)` → `At(e)` → `Ct(e)` → `_(chat).slice(0, e)`。宿主给的是
          // `{ text, meta }` 对象 ⇒ `slice(0, 对象)` 得到空数组 ⇒ `_.has(undefined,'stat_data')`
          // 为假 ⇒ MVU **静默早退**：回复楼层拿不到变量、正文末尾也不会补
          // `<StatusPlaceHolderImpl/>` ⇒ 每轮回复都没有状态栏（真机 v12-1637 实证）。
          // 因此这里统一翻译成"当前最新楼层下标"，与酒馆侧语义一致。
          // 临时诊断：宿主到底发了哪些事件、翻译后的载荷是什么（配 predefine 的
          // `__nyaShellProbe.events` 就能判定事件链断在哪一环）。定位后删除。
          const traceEmit = (arg: unknown) => {
            try {
              const w = window as unknown as { __nyaVarTrace?: unknown[] };
              w.__nyaVarTrace = (w.__nyaVarTrace || [])
                .concat([{ t: Date.now(), k: "emit", ev: hostEvent, arg }])
                .slice(-60);
            } catch {
              /* ignore */
            }
          };
          // ⚠️ 宿主的"回复日志落地"信号**早于**正文进入 messages（真机 v12-1753 实证：
          //    `getChatMessages(2)` 拿到的 `message` 长度为 **0** ⇒ MVU 的 jo 在
          //    `o.message.length < 5` 处**静默 return**，状态栏占位符永不追加）。
          //    因此这里等正文真正就绪再派发：轮询最新楼层，内容可用即发；最多 3s 兜底发一次。
          if (hostEvent === "message:received") {
            void (async () => {
              for (let i = 0; i < 20; i++) {
                const id = api.messages.getLastId();
                const msg = api.messages.getAll()[id];
                if (msg && typeof msg.content === "string" && msg.content.trim().length >= 5) break;
                await new Promise((r) => setTimeout(r, 150));
              }
              const id = api.messages.getLastId();
              traceEmit(id);
              handle?.emit(tavernValue, id);
            })();
            return;
          }
          const resolved =
            hostEvent === "message:received" || hostEvent === "message:sent"
              ? api.messages.getLastId()
              : // ⚠️ CHAT_CHANGED（session:changed）的载荷必须是**当前聊天 id 字符串**：
                // MVU 的初始化谓词是 `SillyTavern.getCurrentChatId() === e`（e = 事件载荷），
                // 给对象会让它判假 → 回滚全部事件处理器（真机 v12-1707 实证：
                // `message_received` 派发到了 iframe 却是 `handlers:0`）。两侧同源 = 同一个 adapter id。
                hostEvent === "session:changed"
                ? (api.messages.diagnostics().sessionId ?? "nyaachat-unsaved")
                : payload;
          // 临时诊断：宿主到底发了哪些事件、翻译后的载荷是什么（配 predefine 的
          // `__nyaShellProbe.events` 就能判定事件链断在哪一环）。定位后删除。
          traceEmit(resolved);
          handle?.emit(tavernValue, resolved);
        }),
      );
    }
    // 会话/角色切换：脚本集合随之变化 ⇒ 重新装配。
    offs.push(ctx.on("session:changed", () => void mount()));
    offs.push(ctx.on("character:changed", () => void mount()));
    // 配置变化（runOnLoad 开关）也重挂。
    offs.push(ctx.on("completion:settings-ready", () => undefined));

    return () => {
      disposed = true;
      requestRemount = null;
      setLibraryOpen(false);
      setLastError(null);
      for (const off of offs) {
        try {
          off();
        } catch (err) {
          log.warn("setup", "事件退订抛错", err);
        }
      }
      handle?.dispose();
      handle = null;
      container.remove();
      setCardApiPredefine(null);
    };
  },
  SettingsPanel,
};

export default plugin;

/** 供 t7/探针使用：插件内部状态的重置入口（生产不调用）。 */
export function resetScriptRunnerForTests(): void {
  lastError = null;
  errorListeners.clear();
  libraryOpen = false;
  libraryListeners.clear();
  requestRemount = null;
  void nextScriptId; // 保持导出面稳定（store.ts 的 id 生成在别处使用）
}
