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
/**
 * 初始化忙碌窗口的**硬上限**（兜底放行）。窗口正常结束时走 `settleInitBusy()` 的
 * 就绪判据，而不是靠这个闹钟。
 *
 * ⚠️ 这个窗口现在会**真的挡住用户输入**（宿主 UI 见 ChatComposer 的 `scriptInitBusy`），
 * 所以上限必须给得足够宽：MVU 的脚本求值实测要到 ~14s（`global_Mvu_initialized`），
 * 世界书多的卡（道渊 307 条）更慢。旧值 5s/20s 都会在变量初始化落地前放行，
 * 那正是"用户抢跑 → MVU 在空聊天上完成不可重试的初始化"的窗口。
 */
const INIT_BUSY_MAX_MS = 60000;
/**
 * 「核心就绪」（会话就绪 + 宿主装配 + `window.Mvu` 就位）之后，再等多久才算变量初始化落地。
 *
 * ⚠️ 真机教训：`window.Mvu` 只说明 MVU 求值完了，它的 initvar 还要异步遍历世界书、解析楼层
 * 里的 `<UpdateVariable>`。旧实现（只判 `window.Mvu`）实测窗口只有 ~1s —— 用户既看不到提示，
 * 也照样能在变量落地前抢跑（"输入框变灰"完全没出现）。这里改为：核心就绪后再等**一次楼层变量
 * 写入**（一有写入立刻放行）或等满本静默期。
 */
const SETTLE_QUIET_MS = 5000;
/** 构建标记：在主页面控制台输入 __nyaScriptRunnerBuild 即可确认当前跑的是哪个构建。 */
const BUILD_MARKER = 'v12-2800';
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
    /** `message:rendered` 是否已为当前载体的脚本处理器补发过（见 mount 末尾）。 */
    let backfilled = false;
    // 初始化忙碌窗口：起点 = 打开卡片/会话（早于"等聊天就绪"）；终点 = 就绪判据
    // （见 settleInitBusy）/ 硬上限 / 停用。
    // ⚠️ 这一窗口现在**真的阻塞输入**（宿主 UI 的 ChatComposer 读 setScriptInitBusy），
    // 因此"什么时候结束"直接决定用户会不会抢跑。半导体提示（pointer-events:none 的
    // 浮动文字）曾经只是告知，用户仍能发送 —— 结果就是 MVU 在空聊天上完成一次性、
    // 不可重试的变量初始化（真机日志原文：「不存在任何一条消息，退出」，此后
    // `initialized_lorebooks` 已记名，initvar 永远不再执行，整个会话变量为空、
    // 状态栏只剩兜底值）。
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

    let busyActive = false;
    let busyTimer: ReturnType<typeof setTimeout> | null = null;
    const endBusy = (reason?: string) => {
      if (busyTimer) {
        clearTimeout(busyTimer);
        busyTimer = null;
      }
      if (!busyActive) return;
      busyActive = false;
      if (reason) {
        log.info("host", `脚本初始化窗口结束（${reason}）`);
        // 同时落盘一行：dev 的 console 收集器**只收 warn/error**（info 不进 devlog），
        // 而"窗口到底持续了多久"是判定"用户有没有机会看到阻塞"的唯一客观证据。
        // 定位稳定后可降级（真机 v12-2400 首版就是因为窗口只有 ~1s 而用户完全看不到）。
        try {
          console.warn(`[js-slash-runner] 初始化窗口结束（${reason}）`);
        } catch {
          /* console 被劫持也不影响主流程 */
        }
      }
      setScriptInitBusy(false);
      setNotice(false);
    };
    const beginBusy = () => {
      busyActive = true;
      setScriptInitBusy(true);
      setNotice(true);
      if (busyTimer) clearTimeout(busyTimer);
      busyTimer = setTimeout(() => {
        busyTimer = null;
        endBusy("timeout");
      }, INIT_BUSY_MAX_MS);
    };
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    /**
     * 就绪判据 —— 「已经到达不会造成初始化失败的状态」：
     *   ① 会话就绪（`chatReady()`：会话已解析**且**已有楼层）。缺它 MVU 会走
     *      「不存在任何一条消息，退出」，且不重试 —— 这是**不可逆**的损伤。
     *   ② 宿主 iframe 已装配（脚本真的跑起来了）。
     *   ③ 这张卡**有 MVU 脚本**时，再等 `window.Mvu` 在宿主 iframe 里就位
     *      （= MVU 已完成求值、事件总线与变量 API 都已注册）。
     *   ④ ⚠️ **`window.Mvu` 就位 ≠ 变量初始化完成**（真机教训）：MVU 的 initvar 要
     *      遍历世界书条目、解析楼层里的 `<UpdateVariable>`，全是异步的，可能要数秒。
     *      只等 ③ 的话窗口只有 ~1s，用户既看不到任何提示，也照样能在变量落地前抢跑。
     *      所以 ③ 之后再等**一次楼层变量写入**（指纹变化 ⇒ MVU 已经在写变量，立即放行），
     *      或等满 `SETTLE_QUIET_MS` 静默期。
     */
    const settleInitBusy = async (opts: { hasMvu: boolean }) => {
      const startedAt = Date.now();
      let coreReadyAt = 0;
      let lastFingerprint = "";
      for (let i = 0; i < 300 && !disposed; i++) {
        if (disposed) return;
        const frame = container.querySelector<HTMLIFrameElement>(
          "iframe[data-js-slash-runner-host]",
        );
        const win = frame?.contentWindow as unknown as Record<string, unknown> | null | undefined;
        const coreReady = api.messages.chatReady() && !!frame && (!opts.hasMvu || !!(win && win.Mvu));
        if (coreReady) {
          if (!coreReadyAt) coreReadyAt = Date.now();
          const fingerprint = JSON.stringify(
            api.variables.getVariables("message", { messageId: "latest" }) ?? {},
          );
          if (!lastFingerprint) {
            lastFingerprint = fingerprint;
          } else if (fingerprint !== lastFingerprint) {
            endBusy(`variables-written ${Date.now() - startedAt}ms`);
            return;
          }
          if (Date.now() - coreReadyAt >= SETTLE_QUIET_MS) {
            endBusy(`settle-quiet ${Date.now() - startedAt}ms`);
            return;
          }
        }
        await sleep(250);
      }
      endBusy("settle-aborted");
    };

    const mount = async () => {
      if (disposed || mounting) return;
      // ⚠️ mounting 必须在**等待之前**置位：等就绪可能耗时数秒，其间 session:changed /
      // character:changed 会再触发一次 mount，两个等待同时通过就会各自建一个宿主 iframe
      // （MVU 被初始化两次）。置位后走到 finally 再复位。
      mounting = true;
      // `message:rendered` 的补发只做一次（见 mount 末尾）。每次重挂载重置：新载体的脚本
      // 处理器是全新的，需要重新补一遍已渲染楼层。
      backfilled = false;
      // 忙碌窗口从"打开卡片"就开始：等待 + 装配 + 变量落地整段都要挡住输入。
      let runOnLoad = ctx.getConfig().runOnLoad !== false;
      let scripts = api.character.getScripts().filter((s) => s.enabled);
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
        //
        // ⚠️ 超时后**不再放行装配**（旧行为：打一行 warn 照装）。空聊天上的 MVU 初始化是
        // **不可逆**的：它会写下 `initialized_lorebooks`（记名），此后 initvar 永远跳过，
        // 整个会话的变量都是空的。这里直接放弃本次装配并放行输入 —— 用户发出第一条消息后
        // 会话落地，`session:changed` 会再触发一次 mount，那时的 chatReady 才是真的。
        if (scripts.length > 0 && runOnLoad) beginBusy();
        for (let i = 0; i < 120 && !disposed && !api.messages.chatReady(); i++) {
          await sleep(150);
        }
        if (disposed) return;
        if (!api.messages.chatReady()) {
          const snap = snapshot();
          log.warn(
            "host",
            "等待聊天就绪超时（18s），本次不装配脚本宿主（避免 MVU 在空聊天上完成不可重试的变量初始化）；等会话落地后由 session:changed 重试",
            snap,
          );
          dumpProbe("等待聊天就绪超时（18s）", snap);
          endBusy("chat-not-ready");
          return;
        }
        // 会话可能在这一窗口里换过角色/脚本，重新取一次权威值。
        runOnLoad = ctx.getConfig().runOnLoad !== false;
        scripts = api.character.getScripts().filter((s) => s.enabled);
        if (scripts.length > 0 && runOnLoad) {
          if (!busyActive) beginBusy();
          // 这张卡是否真的会加载 MVU（脚本名/id 含 mvu）——决定要不要多等一步
          // `window.Mvu` 就位。有 MVU 的卡若不等，用户就可能在 MVU 完成求值前发送。
          const hasMvu = scripts.some((s) => /mvu/i.test(`${s.name ?? ""} ${s.id ?? ""}`));
          void settleInitBusy({ hasMvu });
        } else {
          // 没有启用的脚本（或 runOnLoad 关闭）⇒ 根本不存在"变量初始化窗口"，立即放行。
          endBusy("no-scripts");
        }
        handle?.dispose();
        handle = null;
        handle = await createScriptHost().mount({
          container,
          scripts,
          api,
          runOnLoad,
          onScriptResult: (scriptId, ok, error) => {
            // ⚠️ 这里**不再**解除忙碌窗口：第一个脚本返回 ≠ 变量初始化落地。解除由
            // settleInitBusy 的就绪判据负责（旧行为会让用户在 MVU 写变量之前就能发送）。
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

        // ── `message:rendered` 的**补发**（真机实测的时序坑）────────────────────────
        // 问题：楼层的 `MessageItem` 挂载时（实测 ~6s）本插件的订阅还没建立 ——
        //   `mount()` 要先等聊天就绪，MVU 脚本求值完还要更久（实测 `global_Mvu_initialized`
        //   出现在 ~14s）。宿主那条 `emitPluginEvent("message:rendered")` 是**同步直发**
        //   （见 `runtime.ts` 的 `emitPluginEvent`：没有订阅者就直接 return），
        //   于是它在插件听到之前就消失了 ⇒ 派发记录里恒为 0 次。
        // 修法：本插件是"晚来的订阅者"，就由它自己**补发**一次已渲染楼层的事件 ——
        //   这也正是 ST 的做法（渲染器晚挂载时会把已有楼层补渲染一遍）。
        // 时序：必须等 `window.Mvu` 就位再发，否则脚本侧处理器还没注册（发了等于没发）。
        // 幂等：`backfilled` 标志 + 每次 mount 重置，避免重挂载时重复补发。
        if (runOnLoad && scripts.length > 0) {
          void (async () => {
            const frame = container.querySelector<HTMLIFrameElement>(
              'iframe[data-js-slash-runner-host]',
            );
            if (!frame) return;
            for (let i = 0; i < 60 && !disposed && frame.isConnected; i++) {
              const w = frame.contentWindow as unknown as { Mvu?: unknown } | null;
              if (w && w.Mvu) break;
              await new Promise((r) => setTimeout(r, 500));
            }
            if (disposed || !frame.isConnected || backfilled) return;
            backfilled = true;
            const msgs = api.messages.getAll();
            for (let idx = 0; idx < msgs.length; idx++) {
              handle?.emit(TAVERN_EVENTS.CHARACTER_MESSAGE_RENDERED, idx);
            }
            log.info("host", `已补发 ${msgs.length} 条 message:rendered（订阅晚于楼层挂载）`);
          })();
        }
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
        // 60 条（原先只取 12）：MVU 的"变量更新失败/SCHEMA 违规"这类警告很容易被
        // 之后的常规日志冲掉，抓不全就只剩猜。
        console: tail("__nyaScriptConsole", 60),
        // 另外单独抽一份"变量相关"的日志（不受上面那 60 条窗口限制）。
        varLogs: (() => {
          const arr = w.__nyaScriptConsole;
          if (!Array.isArray(arr)) return [];
          return arr
            .filter((c) =>
              /变量|SCHEMA|schema|更新|失败|错误|delta|path|UpdateVariable/i.test(
                String((c as { m?: unknown })?.m ?? ""),
              ),
            )
            .slice(-30);
        })(),
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

    // 主页面可直接打印的诊断：控制台输入 __nyaScriptRunnerDiag()    // ⚠️ 同时打一行 **JSON 字符串**：dev 的 console 收集器会把嵌套对象截断成 {…}
    //（真机贴回来的日志里 `iframes: 1, …` 就是被截断的），JSON 一行才能完整回贴。
    const dumpProbe = (label: string, s: unknown) => {
      console.warn(`[js-slash-runner] ${label}`, s);
      try {
        console.warn(`[js-slash-runner] ${label}JSON ` + JSON.stringify(s));
      } catch {
        console.warn(`[js-slash-runner] ${label}JSON (序列化失败)`);
      }
    };
    /**
     * 让 MVU 自己解析一遍**最新消息**（`Mvu.parseMessage` 就是它内部 `Yt` 用的同一个 `$t`）。
     * 返回：命令块原文、解析前后的 `stat_data` 摘要、是否发生变化。
     * 这条证据是"变量更新了但没进状态栏"类问题的分水岭：命令没解析出来 / 解析出来了没被应用。
     */
    const mvuParseProbe = async () => {
      try {
        const frame = document.querySelector<HTMLIFrameElement>("iframe[data-js-slash-runner-host]");
        const w = frame?.contentWindow as unknown as {
          Mvu?: {
            parseMessage?: (m: string, d: unknown) => Promise<unknown>;
            getMvuData?: (o: unknown) => unknown;
          };
        } | null;
        const Mvu = w?.Mvu;
        if (!Mvu?.parseMessage || !Mvu.getMvuData) return "NO_PARSE_API";
        const lastId = api.messages.getLastId();
        const msg = api.messages.getAll()[lastId];
        const text = typeof msg?.content === "string" ? msg.content : "";
        const data = Mvu.getMvuData({ type: "message", message_id: lastId });
        const head = (v: unknown) =>
          JSON.stringify((v as { stat_data?: unknown })?.stat_data ?? null).slice(0, 240);
        const before = head(data);
        const parsed = await Mvu.parseMessage(text, data);
        const after = head(parsed);
        const patch = text.match(/<(json_?patch)>([\s\S]*?)<\/\1>/i);
        // ── 变体二分：MVU 的解析器 Ft 拿的是「整段正文」，所以只测原文无法区分
        //    "块本身有问题" 与 "正文里别的东西干扰了正则"。这里再用**从原文里抠出来的
        //    patch 内容**重新拼一个最小块，单独解析一次。
        let patchOnlyChanged: boolean | string = "SKIP";
        let patchOnlyNote = "";
        if (patch) {
          const minimal = `<UpdateVariable>\n<JSONPatch>\n${patch[2]}\n</JSONPatch>\n</UpdateVariable>`;
          const d2 = Mvu.getMvuData({ type: "message", message_id: lastId });
          const b2 = head(d2);
          try {
            const r2 = await Mvu.parseMessage(minimal, d2);
            patchOnlyChanged = head(r2) !== b2;
          } catch (err) {
            patchOnlyChanged = "ERR";
            patchOnlyNote = String(err);
          }
        }
        const blockStart = text.indexOf("<UpdateVariable");
        // ── 模拟 MVU 的 Ct(e)/At(e)：Ct 是在 SillyTavern.chat 的 **slice(0, e)** 上从后往前找
        //    「同时含 stat_data 与 schema」的楼层。它决定了 Yt(e) 到底拿哪一层的变量去应用。
        const ctProbe = (() => {
          try {
            const frame = document.querySelector<HTMLIFrameElement>(
              "iframe[data-js-slash-runner-host]",
            );
            const w = frame?.contentWindow as unknown as
              | { SillyTavern?: { chat?: unknown } }
              | null;
            const chat = w?.SillyTavern?.chat;
            if (!Array.isArray(chat)) return "NO_CHAT";
            const e = api.messages.getLastId();
            const slice = chat.slice(0, e) as Array<{ variables?: unknown[]; swipe_id?: number }>;
            let found = -1;
            for (let i = slice.length - 1; i >= 0; i--) {
              const slot = slice[i] || {};
              const v = ((slot.variables || [])[slot.swipe_id ?? 0] || {}) as {
                stat_data?: unknown;
                schema?: unknown;
              };
              if (v.stat_data !== undefined && v.schema !== undefined) {
                found = i;
                break;
              }
            }
            return { e, chatLen: chat.length, sliceLen: slice.length, atIndex: found };
          } catch (err) {
            return "ERR " + String(err);
          }
        })();
        // 去 schema 的最小块：判定"严格 schema 是否在拒绝写入"
        let noSchemaChanged: boolean | string = "SKIP";
        let replaceOnlyChanged: boolean | string = "SKIP";
        if (patch) {
          const d3 = Mvu.getMvuData({ type: "message", message_id: lastId }) as Record<string, unknown>;
          delete d3.schema;
          const b3 = head(d3);
          try {
            const r3 = await Mvu.parseMessage(
              `<UpdateVariable>\n<JSONPatch>\n${patch[2]}\n</JSONPatch>\n</UpdateVariable>`,
              d3,
            );
            noSchemaChanged = head(r3) !== b3;
          } catch (err) {
            noSchemaChanged = "ERR " + String(err);
          }
          const d4 = Mvu.getMvuData({ type: "message", message_id: lastId });
          const b4 = head(d4);
          try {
            const r4 = await Mvu.parseMessage(
              `<UpdateVariable>\n<JSONPatch>\n[{"op":"replace","path":"/世界/当前场所","value":"PROBE_PLACE"}]\n</JSONPatch>\n</UpdateVariable>`,
              d4,
            );
            replaceOnlyChanged = head(r4) !== b4;
          } catch (err) {
            replaceOnlyChanged = "ERR " + String(err);
          }
        }
        // ── 直接监听 MVU 的 COMMAND_PARSED：这是唯一能看到「解析器 Ft 到底产出了什么」的位置。
        //    它为空 ⇒ 解析问题；非空而变量不变 ⇒ 应用/写入被拒。
        const parsedProbe = await (async () => {
          try {
            const frame = document.querySelector<HTMLIFrameElement>(
              "iframe[data-js-slash-runner-host]",
            );
            const w = frame?.contentWindow as unknown as
              | {
                  eventOn?: (n: string, h: (d: unknown, cmds?: unknown, raw?: unknown) => void) => void;
                  Mvu?: {
                    parseMessage?: (m: string, d: unknown) => Promise<unknown>;
                    getMvuData?: (o: unknown) => unknown;
                  };
                  tavern_events?: Record<string, string>;
                }
              | null;
            if (!w?.eventOn || !w.Mvu?.parseMessage) return "NO_API";
            const evName =
              (w.tavern_events && w.tavern_events.COMMAND_PARSED) || "mag_command_parsed";
            const seen: unknown[] = [];
            w.eventOn(evName, (_d: unknown, cmds?: unknown) => {
              seen.push(cmds);
            });
            const d = w.Mvu.getMvuData({
              type: "message",
              message_id: api.messages.getLastId(),
            });
            try {
              await w.Mvu.parseMessage(text, d);
            } catch {
              /* 结果由下面 seen 反映 */
            }
            return seen.map((s) =>
              Array.isArray(s)
                ? { len: s.length, first: JSON.stringify(s[0] ?? null).slice(0, 200) }
                : String(s),
            );
          } catch (err) {
            return "ERR " + String(err);
          }
        })();
        return {
          textLen: text.length,
          hasUpdateVariable: /<UpdateVariable/i.test(text),
          hasPatchTag: !!patch,
          patchTagOpenCount: (text.match(/<json_?patch>/gi) || []).length,
          patchTagCloseCount: (text.match(/<\/json_?patch>/gi) || []).length,
          patchBlock: patch ? patch[2].trim().slice(0, 600) : null,
          // 前 40 个字符里的不可见/非 ASCII 码点（零宽字符、全角空格等会让解析器直接失败）
          patchCodes: patch
            ? Array.from(patch[2].trim().slice(0, 40))
                .map((c) => c.charCodeAt(0))
                .filter((c) => c < 32 || c > 126)
            : null,
          blockFromText: blockStart >= 0 ? text.slice(blockStart, blockStart + 900) : null,
          before,
          after,
          changed: before !== after,
          patchOnlyChanged,
          patchOnlyNote,
          noSchemaChanged,
          replaceOnlyChanged,
          ctProbe,
          parsedProbe,
        };
      } catch (err) {
        return "ERR " + String(err);
      }
    };
    const snapshot = () => ({
      build: BUILD_MARKER,
      /** 初始化窗口是否仍挡着输入（前端 `scriptInitBusy`）—— 与窗口时长一起构成可观测证据。 */
      busy: busyActive,
      chatReady: api.messages.chatReady(),
      /** 宿主视角的"最后一条楼层下标"：与 MVU 自己调 `getLastMessageId()` 的结果对照用
       *  （真机日志里 MVU 曾在会话有 3 层时拿到 0 —— 它据此把变量写回了楼层 0）。 */
      lastId: api.messages.getLastId(),
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
          // stat_data 的**顶层键**（截前 8 个）：日志里的 `sd:true` 区分不出"有真实数据"与
          // "只有 MVU 兜底出来的空对象"，这一项才能直接看出变量是否真的落地。
          sdKeys:
            slot && slot.stat_data && typeof slot.stat_data === "object"
              ? Object.keys(slot.stat_data as Record<string, unknown>).slice(0, 8)
              : null,
          sc: !!slot?.schema,
          // `stat_data` 的取值前 140 字符：只列键名（sdKeys）区分不出"哪个楼层是旧值"，
          // 而"变量更新了但状态栏没跟上"恰恰要靠**逐楼层取值的差异**来定位。
          sdHead:
            slot && slot.stat_data && typeof slot.stat_data === "object"
              ? JSON.stringify(slot.stat_data).slice(0, 140)
              : null,
          /** schema 前 120 字符：MVU 的写入校验按 schema 做，判断"更新被拒"时要看它。 */
          schemaHead:
            slot && slot.schema && typeof slot.schema === "object"
              ? JSON.stringify(slot.schema).slice(0, 120)
              : null,
          /**
           * 正文里 `<UpdateVariable>` 块的前 300 字符：MVU 的变量更新入口是拿**消息正文**去解析的
           * （`Yt(e)` → `$t(n, o)`），所以"patch 为什么没应用"最终要看这段原文的格式。
           */
          uvBlock: (() => {
            const c = typeof m.content === "string" ? m.content : "";
            const i = c.indexOf("<UpdateVariable");
            if (i < 0) return null;
            const j = c.indexOf("</UpdateVariable", i);
            return j < 0 ? c.slice(i, i + 2500) : c.slice(i, j + 20).slice(0, 2500);
          })(),
          // 正文尾部：MVU 追加状态栏占位符改的就是正文 —— 用它判断"追加有没有落到消息上"。
          hasPh: typeof m.content === "string" && m.content.indexOf("StatusPlaceHolderImpl") >= 0,
          /** 正文长度：定位"重新生成后正文消失"这类问题时要能一眼看出哪条消息的内容变空了。 */
          len: typeof m.content === "string" ? m.content.length : null,
          tail: typeof m.content === "string" ? m.content.slice(-50) : null,
        };
      }),
      lorebook: lorebookProbe(),
      // 卡片 iframe **实际读到**的变量（每张卡一个）：与上面的逐楼层取值对照，就能判定
      // "变量更新了但状态栏没跟上"是断在「通知没到卡片」还是「卡片读的楼层不是被更新的那条」。
      cards: (() => {
        try {
          return Array.from(
            document.querySelectorAll<HTMLIFrameElement>("iframe[id^=nyaachat-card]"),
          ).map((f) => {
            const w = f.contentWindow as unknown as
              | { getAllVariables?: () => unknown; __nyaCardDispatch?: unknown }
              | null;
            let sdHead: string | null = null;
            try {
              const all = w?.getAllVariables?.() as { stat_data?: unknown } | undefined;
              sdHead = all && all.stat_data ? JSON.stringify(all.stat_data).slice(0, 140) : null;
            } catch {
              sdHead = "ERR";
            }
            return {
              id: f.id,
              dispatch: typeof w?.__nyaCardDispatch,
              sdHead,
            };
          });
        } catch {
          return [];
        }
      })(),
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
    // ⚠️ 只在聊天 id **真正变化**时才派发 chat_id_changed。重复派发会让 MVU 反复重建监听器，
    // 而它的清理顺序是 abort() 在前、移除监听器在后 —— 中间一旦出错就留下"已 abort 但仍在册"
    // 的僵尸处理器，我们的 message_received 正好喂给它（n?.aborted 静默返回 ⇒ Yt 不执行 ⇒
    // 回复楼层永远不加 StatusPlaceHolderImpl）。真机 v12-2109 实证：回复时刻只读 2 次会话 id、
    // 值未变，chatIdHistory 全程同一个 id。
    let lastChatId: string | null = null;
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
          // ⚠️ 宿主的"回复日志落地"信号**早于**正文进入 messages（真机 v12-2109 实证：
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
              // 回复落地后自动留一份**收尾快照**：把"每条楼层的变量取值"与"每张卡片实际读到的
              // 变量"同时写进日志。定位"MVU 变量更新了、状态栏没跟上"这类问题时，这两组数据
              // 缺一不可 —— 不必再让用户手动跑 __nyaScriptRunnerDiag()。
              setTimeout(() => {
                if (disposed) return;
                // 先让 MVU 自己解析一次最新消息（`Mvu.parseMessage` 是它公开的入口，
                // 内部就是 `Yt` 用的那个 `$t`）—— "变量更新了但没进状态栏"这类问题，
                // 只有这一步能直接指出是"命令没解析出来"还是"应用/写入被拒"。
                void (async () => {
                  const parsed = await mvuParseProbe();
                  if (!disposed) dumpProbe("回复后快照", { ...snapshot(), mvuParse: parsed });
                })();
              }, 5000);
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
          // ⚠️ 聊天 id 未变就**不派发** chat_id_changed（见上方 lastChatId 的注释）：
          //    重复派发 → MVU 反复重建监听器 → 留下已 abort 的僵尸处理器 → Yt 不执行。
          if (hostEvent === "session:changed") {
            const id = api.messages.diagnostics().sessionId ?? "nyaachat-unsaved";
            if (id === lastChatId) return;
            lastChatId = id;
          }
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
      // 停用/卸载时**必须**放开输入：否则 UI 会一直停在"初始化中"（脚本已不再存在）。
      endBusy("disposed");
      notice.remove();
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
