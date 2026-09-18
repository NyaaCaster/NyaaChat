/**
 * EJS 模板执行载体 —— **1×1 隐藏 srcdoc iframe**（同源、**刻意不加** `sandbox`）。
 *
 * 定位（SSOT `开发计划-SSOT.md` §3.3 / D6 / D7）：把 `engine/compile.ts` 产出的
 * **函数体源码**拼成 `async function anonymous(locals, escapeFn, include, rethrow) { … }`，
 * 作为**普通 `<script>`（非 `type=module`）**注入 iframe 执行 —— `with` 在严格模式下非法，
 * module 会得到 `SyntaxError: Strict mode code may not include a with statement`
 * （`EJS本地自测方法.md` §2.2）。
 *
 * ## 为什么不复用 `plugins/js-slash-runner/executor/srcdocHost.ts`
 * SSOT D7 明确「自建轻量载体」：JSR 那套要装配 importmap + 五个运行时库 + 事件总线，
 * 与 EJS 的需求（一个函数、一份 env）差了一个数量级；形态借鉴，代码不复用。
 *
 * ## 为什么全文不出现动态求值构造器
 * `nginx.conf:51/95` 的 CSP 是 `script-src 'self' 'unsafe-inline'`（**无** `unsafe-eval`）：
 * 内联脚本可执行，任何动态构造函数路径都会被拦下。本文件因此只做**源码字符串拼接 +
 * `<script>` 注入**（与 D5 的引擎选型同一条路线），且不出现该 CSP 禁止的原语。
 *
 * ## 协议（控制面走 postMessage，env 面走同源直读）
 * 1. **握手**：iframe 载入后 `postMessage({ __nyaEjsCarrier: nonce, type: "ready" })`；
 *    父窗口在此之前已挂好监听（同源 + nonce + `event.source === iframe.contentWindow` 三重校验）。
 * 2. **触发**：父窗口 `postMessage({ …, type: "run", batchId, jobs: [{ id, hash }] })`。
 *    消息里**只有 id/hash**，模板正文与 env 都不进消息通道（避免整段模板进日志/异常上报）。
 * 3. **回传**：iframe `postMessage({ …, type: "result", batchId, results })`，其中
 *    `results = [{ id, ok, text, error, errors, writes }]`（`error` 是对外冻结接口的
 *    `CarrierRenderResult.error`，`errors` 是其完整列表形态）。若 `writes` 里有不可结构化
 *    克隆的值（函数 / Symbol），退化为可移植投影后再发一次。
 *
 * ## env 面为什么走同源直读（不把快照 postMessage 过去）
 * 快照里有**函数**（未实现符号桩表）与 `_`（`lodashSubset`）—— 结构化克隆会把函数**静默丢掉**。
 * 同源 iframe 直读 `window.parent.__nyaEjsCarriers[nonce].env`（非 sandbox 的前提，D7）既保住
 * 函数面，也保住了 **realm 一致性**：合并视图与 `_` 同在父窗口 realm，`_.cloneDeep` /
 * `_.omit`（卡里实测用到）不会因为跨 realm 的原型判定而退化成"原样返回"。
 * 快照仍按 `env.ts` 的契约保持**纯数据**（clone 安全），因此本载体对"被克隆过的快照"同样可用：
 * 桩表缺失时由 `UNIMPLEMENTED_ENV_SYMBOLS` 重建，`YAML` 由 iframe 自行 `import()`。
 *
 * ## 7 个符号的语义基准（技术性说明 §4.1、§5；env.ts 头注的契约）
 * `getvar` / `getMessageVar` / `setvar` / `setMessageVar` / `getwi` / `YAML` / `_`。
 * ⚠️ **读侧一律走"合并视图"**（`global → chat → message` 浅合并后深拷贝），理由有二：
 *   ① 上游 `getVariable` 的缺省 `scope` 是 `'cache'`，而 `STATE.cacheVars` 正是
 *      `cloneDeep(assign({}, global, initial, chat, msgVars))` —— 即**含 message 的合并树**
 *      （`.ref/ST-Prompt-Template/src/function/variables.ts:37-63,437-482`）；`getMessageVar`
 *      无 `withMsg` 时读的也是它（`:481`）⇒ 二者在**缺省作用域**下同源。
 *   ② 两张目标卡大量写作 `getvar('stat_data')` / `getvar('stat_data.事件.信号', {defaults})`
 *      **不带 scope**，而 MVU 的 `stat_data` 在**楼层（message）作用域**里 —— 只读 `chat`
 *      会静默取到 `defaults`，条目会走错分支。
 *   ⇒ 缺省 / `scope:'cache'` / `scope:'message'` 一律读**合并视图**（`getMessageVar` 同此，
 *     与上游 `:481` 与 P0 桩 env 的 `getvar === getMessageVar` 一致）；只有显式的
 *     `scope:'chat'`（ST 的 `'local'`）与 `scope:'global'` 各读各的作用域。
 * ⚠️ **写侧默认落 message 作用域**（上游 `setVariable` 的 `switch (scope || 'message')`，
 *   `variables.ts:225`），并把改动**就地写进合并视图** ⇒ 同一条目后续 `getvar` 立刻可读
 *   （保真 ST；P0 黄金基准的桩 env 就是"get/Set 同一棵树"）。
 *
 * ## 写入（D9）如何回流
 * iframe 内的 `setvar` / `setMessageVar` 把写入意图推入**本轮批次私有**的数组，
 * 载体按"本条目开始前的长度"切片取走**本条目新增**的写入，随结果回传；
 * 由 `host/renderEntry.ts` 收集后交宿主在 pre-pass 结束后统一提交一次。
 * 每条目用的是**私有深拷贝视图** ⇒ 失败条目的写入不会污染宿主快照（SSOT §2.7）。
 *
 * ## 失败语义（K1 / K3）
 * 每条目**各自一个批次、各自一个超时**，顺序派发：一条超时/抛错只降级它自己，
 * 其余条目继续渲染（同步死循环会占住 iframe 事件循环，那种情形只能靠 K1 的软上限 + UI 告知）。
 * 任何失败都**不抛给调用方**，而是回 `{ ok:false, text:"", error }`（**绝不把 `<% %>` 原文
 * 送进提示词**），并回调 `onError`（仅 `destroy()` 后的调用不回调，避免销毁期刷屏）。
 */
import type { PromptTextWrite } from "../../../src/plugins/promptText";
import { escapeXML } from "../engine/escape";
import { lodashSubset } from "../lodashSubset";
import { UNIMPLEMENTED_ENV_SYMBOLS } from "./env";

/** 单条目渲染的默认软上限（ms）；SSOT §3.3「与块数挂钩」的软上限在当前实现里按条目计。 */
const DEFAULT_TIMEOUT_MS = 5_000;
/** iframe 握手（srcdoc 载入 + ready）超时；与渲染超时解耦，避免小 timeoutMs 把握手判死。 */
const HANDSHAKE_TIMEOUT_MS = 5_000;
/** 错误文案上限：`rethrow` 会带 ±3 行模板上下文，截断以免长行模板把日志撑爆。 */
const MAX_ERROR_CHARS = 800;
/** 消息通道标识键（父窗口与 iframe 两侧都必须携带，防止与其它插件的消息串味）。 */
const CHANNEL_KEY = "__nyaEjsCarrier";
/** 载体 iframe 的 DOM 标记（探针/验证脚本据此定位，见 `EJS本地自测方法.md` O9）。 */
const IFRAME_MARKER = "ejs-template-carrier";
/** 宿主自托管 YAML 的默认路径（`env.ts` 的 `VENDOR_YAML_PATH` 同值；握手后预加载用）。 */
const DEFAULT_YAML_PATH = "/vendor/script-host/yaml/yaml.esm.js";

export interface CarrierRenderRequest {
  /** 条目 id（回传时原样带回，调用方用它归因/去重）。 */
  id: string;
  /** 模板指纹（`engine/compile.ts` 的 `CompiledSource.templateHash`）——函数缓存的键。 */
  templateHash: string;
  /** 函数体源码（**不含** `function` 关键字与参数表）。 */
  functionBody: string;
}

export interface CarrierRenderResult {
  id: string;
  ok: boolean;
  text: string;
  /** 失败原因（已截断到 `MAX_ERROR_CHARS`）；成功时缺省。 */
  error?: string;
  /** 本条目渲染期产生、尚未提交的变量写入意图（D9）。 */
  writes: PromptTextWrite[];
}

export interface CarrierOptions {
  /** 单条目渲染超时（ms）。缺省 `DEFAULT_TIMEOUT_MS`。 */
  timeoutMs?: number;
  /** 降级回调：条目 id + 已截断的失败原因（供 UI/日志归因）。 */
  onError?: (id: string, message: string) => void;
}

export interface Carrier {
  /** 按请求顺序渲染；失败按条目降级，永不 reject。 */
  render(reqs: CarrierRenderRequest[], envSnapshot: Record<string, unknown>): Promise<CarrierRenderResult[]>;
  /** 移除 iframe、注销桥与监听、结算在途批次；幂等。 */
  destroy(): void;
}

/** 变量三作用域（`env.ts` 的 `EjsVariableStore` 数据面；此处只声明用到的部分）。 */
interface SnapshotVariables {
  message?: Record<string, unknown>;
  chat?: Record<string, unknown>;
  global?: Record<string, unknown>;
  messageId?: number | "latest";
}

/** `env.ts` 的 `EjsEnvSnapshot`（数据面；此处按需声明，避免与兄弟模块产生值耦合）。 */
interface SnapshotLike {
  variables?: SnapshotVariables;
  lorebook?: Record<string, string>;
  identity?: { user?: unknown; char?: unknown };
  character?: { id?: unknown; name?: unknown };
  unimplemented?: Record<string, unknown>;
  vendor?: { yamlPath?: unknown };
}

/** 交给 iframe 的 env 载荷（**在父窗口 realm 构造**，iframe 同源直读）。 */
interface FrameEnvPayload {
  /** 合并视图：`global → chat → message` 浅合并后深拷贝（上游 `STATE.cacheVars` 等价物）。 */
  view: Record<string, unknown>;
  /**
   * 显式作用域数据源（各自深拷贝，只给 `scope:'chat' | 'global'` 用）。
   * ⚠️ **没有 message 副本**：上游 `scope:'message'` 的读与写都落在 `STATE.cacheVars`（合并视图）
   * 上，因此 message 作用域在载体里就是 `view` 本身 —— 单独留一份副本只会变成死字段。
   */
  scopes: { chat: Record<string, unknown>; global: Record<string, unknown> };
  messageId: number | "latest";
  lorebook: Record<string, string>;
  identity: { user: string; char: string };
  character: { id: string | null; name: string };
  /** 未实现符号 → 抛错桩（优先用快照自带的，缺则按 `UNIMPLEMENTED_ENV_SYMBOLS` 重建）。 */
  unimplemented: Record<string, unknown>;
  /** YAML 产物的**绝对 URL**（iframe 自行 `import()`）；`null` = 快照未给路径。 */
  yamlUrl: string | null;
  /** lodash 子集（父窗口 realm 的**同一实现**：`setRandomSource` 对模板立即生效）。 */
  lodash: unknown;
}

/** 父窗口侧每载体一格：env 由同源 iframe 直读（含函数，故不能走结构化克隆）。 */
interface CarrierBridgeSlot {
  env: FrameEnvPayload | null;
}

declare global {
  interface Window {
    /** 载体桥注册表：`nonce → { env }`。同源 iframe 通过 `window.parent` 读它。 */
    __nyaEjsCarriers?: Record<string, CarrierBridgeSlot>;
    /** iframe 内的函数缓存：`templateHash → async function`（模板不变时复用，不重复注入）。 */
    __nyaEjsFns?: Record<string, unknown>;
    /** iframe 内环形错误缓冲（注入语法错/未捕获错误），父窗口同源直读。 */
    __nyaEjsErrors?: Array<{ message: string; at: number }>;
  }
}

interface WireJob {
  id: string;
  hash: string;
}

interface WireResult {
  id?: unknown;
  ok?: unknown;
  text?: unknown;
  error?: unknown;
  /** iframe 侧的完整错误列表（对称于冻结接口的 `error?: string`，见文件头协议 §3）。 */
  errors?: unknown;
  writes?: unknown;
}

type DispatchOutcome =
  | { kind: "results"; results: WireResult[] }
  | { kind: "timeout" }
  | { kind: "destroyed" }
  | { kind: "broken"; message: string };

/**
 * 创建载体。**不在创建时碰 DOM** —— iframe 首次 `render()` 时才挂载
 * （插件的 `setup` 可能早于宿主页面就绪，惰性化可避免在此时抛错）。
 */
export function createCarrier(options: CarrierOptions = {}): Carrier {
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const onError = options.onError;
  const nonce = createNonce();
  const targetOrigin = resolveTargetOrigin();

  let iframe: HTMLIFrameElement | null = null;
  let ready: Promise<boolean> | null = null;
  /** 握手的一次性结算函数（ready 到达 / 超时 / 销毁都经它）。 */
  let settleReady: ((value: boolean) => void) | null = null;
  let destroyed = false;
  let sequence = 0;

  /** 在途批次：batchId → { timer, finish }。 */
  const pending = new Map<string, { timer: number; finish: (outcome: DispatchOutcome) => void }>();
  /** 已成功注入并注册的函数指纹（模板不变 ⇒ 后续轮只更新 env）。 */
  const injectedHashes = new Set<string>();
  /** 注入即失败的指纹 → 错误文案（语法错是确定性的，不每轮重试）。 */
  const failedHashes = new Map<string, string>();
  /** render 串行化：并发调用不会互相污染 env 载荷与批次。 */
  let queue: Promise<unknown> = Promise.resolve();

  const onMessage = (event: MessageEvent): void => {
    if (destroyed || !iframe || event.source !== iframe.contentWindow) {
      return;
    }
    const data = event.data as Record<string, unknown> | null;
    if (!data || typeof data !== "object" || data[CHANNEL_KEY] !== nonce) {
      return;
    }
    if (data.type === "ready") {
      settleReady?.(true);
      return;
    }
    if (data.type !== "result") {
      return;
    }
    const batchId = String(data.batchId ?? "");
    const entry = pending.get(batchId);
    if (!entry) {
      return;
    }
    pending.delete(batchId);
    window.clearTimeout(entry.timer);
    const results = Array.isArray(data.results) ? (data.results as WireResult[]) : [];
    entry.finish({ kind: "results", results });
  };

  function hasDom(): boolean {
    return typeof window !== "undefined" && typeof document !== "undefined" && !!document.documentElement;
  }

  /** 挂载 iframe 并等待 ready 握手；返回是否可用（超时/无 DOM ⇒ false，不抛）。 */
  function mount(): Promise<boolean> {
    if (ready) {
      return ready;
    }
    if (destroyed || !hasDom()) {
      return Promise.resolve(false);
    }
    ready = new Promise<boolean>((resolve) => {
      let settled = false;
      let handshakeTimer = 0;
      const settle = (value: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (handshakeTimer) {
          window.clearTimeout(handshakeTimer);
        }
        settleReady = null;
        resolve(value);
      };
      handshakeTimer = window.setTimeout(() => settle(false), HANDSHAKE_TIMEOUT_MS);
      settleReady = settle;

      const frame = document.createElement("iframe");
      // 隐藏但仍参与脚本执行：`display:none` 会改变某些布局/可见性判定，
      // 用 1×1 + 不可见定位更温和（与 JSR 载体同形）。
      frame.setAttribute("aria-hidden", "true");
      frame.setAttribute("tabindex", "-1");
      frame.setAttribute("data-ejs-template-carrier", IFRAME_MARKER);
      frame.style.cssText =
        "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;border:0;left:-9999px;";
      // ⚠️ 刻意**不加** `sandbox`：同源是「直读父窗口 env（含函数）」与「回传结果」的前提。
      // 模板与宿主同源运行 ⇒ 只运行可信来源的卡（安全告知见插件设置面板，SSOT §8）。
      iframe = frame;

      const carriers = (window.__nyaEjsCarriers = window.__nyaEjsCarriers ?? {});
      carriers[nonce] = { env: null };

      window.addEventListener("message", onMessage, false);
      (document.body ?? document.documentElement).appendChild(frame);
      frame.srcdoc = buildCarrierHtml(nonce, targetOrigin);
    });
    return ready;
  }

  /**
   * 注入一个模板函数：`window.__nyaEjsFns[hash] = async function anonymous(…) { body }`。
   *
   * - **普通 script**（`createElement("script")` + `textContent`，不带 `type`）：`with` 需要非严格模式。
   * - 模板不变时**不重复注入**（调用方已按 `injectedHashes` 去重）。
   * - 注入后立刻同源校验函数是否真的注册成功：生成源码若有语法错，该 script 整体失败且不会注册，
   *   此时把 iframe 内错误缓冲里的文案取出来（否则调用方只会看到「未注册」这种无信息量的报错）。
   *
   * @returns 失败文案；成功返回 `null`
   */
  function injectFunction(templateHash: string, functionBody: string): string | null {
    const frame = iframe;
    const doc = frame?.contentDocument;
    const win = frame?.contentWindow;
    if (!frame || !doc || !win) {
      return "载体 iframe 不可用（注入前已销毁或被剥离）";
    }
    const errorsBefore = win.__nyaEjsErrors?.length ?? 0;
    const source =
      "window.__nyaEjsFns[" +
      JSON.stringify(templateHash) +
      "] = async function anonymous(locals, escapeFn, include, rethrow) {\n" +
      functionBody +
      "\n};";
    const script = doc.createElement("script");
    script.setAttribute("data-ejs-template-hash", templateHash);
    script.textContent = source;
    const bucket = doc.body ?? doc.documentElement;
    if (!bucket) {
      return "载体 iframe 文档不可写";
    }
    bucket.appendChild(script);

    if (typeof win.__nyaEjsFns?.[templateHash] !== "function") {
      const fresh = (win.__nyaEjsErrors ?? [])
        .slice(errorsBefore)
        .map((item) => item.message)
        .filter(Boolean);
      const detail = fresh.length ? fresh.join(" / ") : "生成源码未被注册（可能是语法错误）";
      return bounded(`模板注入失败：${detail}`);
    }
    return null;
  }

  /** 派发一个批次并等待结果；超时/销毁/异常都转成 outcome，不 reject。 */
  function startDispatch(jobs: WireJob[]): Promise<DispatchOutcome> {
    const batchId = "b" + String(++sequence);
    return new Promise<DispatchOutcome>((resolve) => {
      let settled = false;
      const finish = (outcome: DispatchOutcome): void => {
        if (settled) {
          return;
        }
        settled = true;
        const entry = pending.get(batchId);
        if (entry) {
          window.clearTimeout(entry.timer);
          pending.delete(batchId);
        }
        resolve(outcome);
      };
      const timer = window.setTimeout(() => {
        pending.delete(batchId);
        finish({ kind: "timeout" });
      }, timeoutMs);
      pending.set(batchId, { timer, finish });

      const target = iframe?.contentWindow;
      if (!target) {
        finish({ kind: "broken", message: "载体 iframe 不可用" });
        return;
      }
      try {
        target.postMessage({ [CHANNEL_KEY]: nonce, type: "run", batchId, jobs }, targetOrigin);
      } catch (error) {
        finish({ kind: "broken", message: `载体触发失败：${describe(error)}` });
      }
    });
  }

  async function renderOne(req: CarrierRenderRequest): Promise<CarrierRenderResult> {
    if (destroyed) {
      return degrade(req.id, "载体已销毁", false);
    }
    const known = failedHashes.get(req.templateHash);
    if (known !== undefined) {
      return degrade(req.id, known);
    }
    if (!injectedHashes.has(req.templateHash)) {
      const failure = injectFunction(req.templateHash, req.functionBody);
      if (failure) {
        failedHashes.set(req.templateHash, failure);
        return degrade(req.id, failure);
      }
      injectedHashes.add(req.templateHash);
    }

    const outcome = await startDispatch([{ id: req.id, hash: req.templateHash }]);
    if (outcome.kind === "timeout") {
      return degrade(req.id, `渲染超时（> ${timeoutMs} ms），已按条目降级`);
    }
    if (outcome.kind === "broken") {
      return degrade(req.id, outcome.message);
    }
    if (outcome.kind === "destroyed") {
      return degrade(req.id, "载体已销毁", false);
    }
    const wire = outcome.results.find((item) => item && item.id === req.id) ?? outcome.results[0];
    if (!wire) {
      return degrade(req.id, "载体未回传结果");
    }
    if (wire.ok === false) {
      return degrade(req.id, wireErrorText(wire) || "模板执行失败");
    }
    return { id: req.id, ok: true, text: toText(wire.text), writes: toWrites(wire.writes) };
  }

  async function runBatch(
    reqs: CarrierRenderRequest[],
    envSnapshot: Record<string, unknown>,
  ): Promise<CarrierRenderResult[]> {
    const requests = Array.isArray(reqs) ? reqs : [];
    if (destroyed) {
      return requests.map((req) => degrade(req.id, "载体已销毁", false));
    }
    const usable = await mount();
    if (!usable) {
      return requests.map((req) => degrade(req.id, "载体未就绪（iframe 握手超时或当前环境没有 DOM）"));
    }
    if (destroyed) {
      return requests.map((req) => degrade(req.id, "载体已销毁", false));
    }
    // env 由同源 iframe 直读：含函数与模块对象，结构化克隆传不过去。
    const slot = window.__nyaEjsCarriers?.[nonce];
    if (slot) {
      slot.env = buildFramePayload(envSnapshot);
    }
    const results: CarrierRenderResult[] = [];
    for (const req of requests) {
      results.push(await renderOne(req));
    }
    return results;
  }

  /**
   * 降级结果：**永不抛错**，也绝不把模板原文当文本返回（SSOT §2.7 / K3）。
   * `notify=false` 只用于「已销毁」这类非缺陷路径，避免销毁期刷日志。
   */
  function degrade(id: string, message: string, notify = true): CarrierRenderResult {
    const text = bounded(message) || "模板渲染失败";
    if (notify) {
      try {
        onError?.(id, text);
      } catch {
        /* 回调由调用方负责，不因它出错而中断渲染循环 */
      }
    }
    return { id, ok: false, text: "", error: text, writes: [] };
  }

  return {
    render(reqs, envSnapshot) {
      const run = queue.then(
        () => runBatch(reqs, envSnapshot),
        () => runBatch(reqs, envSnapshot),
      );
      queue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      for (const entry of Array.from(pending.values())) {
        window.clearTimeout(entry.timer);
        entry.finish({ kind: "destroyed" });
      }
      pending.clear();
      settleReady?.(false);
      settleReady = null;
      if (typeof window !== "undefined") {
        window.removeEventListener("message", onMessage, false);
      }
      try {
        iframe?.remove();
      } catch {
        /* 已被外部移除：目标状态已达成 */
      }
      iframe = null;
      const carriers = window.__nyaEjsCarriers;
      if (carriers) {
        delete carriers[nonce];
        if (Object.keys(carriers).length === 0) {
          delete window.__nyaEjsCarriers;
        }
      }
    },
  };
}

/**
 * 把 `env.ts` 的快照投影成载体载荷（**全部在父窗口 realm 完成**，见文件头"realm 一致性"）。
 *
 * 视图 = 上游 `STATE.cacheVars` 的等价物：`cloneDeep(Object.assign({}, global, chat, message))`
 * （`variables.ts:52`；message 最后 ⇒ 优先级最高，与"楼层变量覆盖会话/全局"一致）。
 */
function buildFramePayload(raw: unknown): FrameEnvPayload {
  const snapshot = (raw && typeof raw === "object" ? raw : {}) as SnapshotLike;
  const variables = (snapshot.variables && typeof snapshot.variables === "object" ? snapshot.variables : {}) as
    SnapshotVariables;
  const globalScope = asRecord(variables.global);
  const chatScope = asRecord(variables.chat);
  const messageScope = asRecord(variables.message);

  const payload: FrameEnvPayload = {
    view: deepCopy(Object.assign({}, globalScope, chatScope, messageScope)),
    scopes: {
      global: deepCopy(globalScope),
      chat: deepCopy(chatScope),
    },
    messageId: variables.messageId === undefined ? "latest" : variables.messageId,
    lorebook: asStringRecord(snapshot.lorebook),
    identity: {
      user: asString(snapshot.identity?.user),
      char: asString(snapshot.identity?.char),
    },
    character: {
      id: snapshot.character?.id === undefined || snapshot.character.id === null ? null : asString(snapshot.character.id),
      name: asString(snapshot.character?.name),
    },
    unimplemented: buildUnimplementedTable(snapshot.unimplemented),
    yamlUrl: resolveYamlUrl(snapshot.vendor?.yamlPath),
    lodash: lodashSubset,
  };
  return payload;
}

/**
 * 未实现符号的抛错桩表（D11）。
 * 优先复用快照自带的桩（同源直读 ⇒ 函数还在，保住了 `env.ts` 的错误类型与文案）；
 * 快照曾被结构化克隆（函数被静默丢掉）时，按 `UNIMPLEMENTED_ENV_SYMBOLS` 清单重建。
 */
function buildUnimplementedTable(source: Record<string, unknown> | undefined): Record<string, unknown> {
  const table: Record<string, unknown> = {};
  if (source && typeof source === "object") {
    for (const [name, value] of Object.entries(source)) {
      if (typeof value === "function") {
        table[name] = value;
      }
    }
  }
  for (const name of UNIMPLEMENTED_ENV_SYMBOLS) {
    if (!(name in table)) {
      table[name] = makeUnimplementedStub(name);
    }
  }
  return table;
}

/** 兜底桩：文案与 `env.ts` 的 `EjsSymbolNotImplementedError` 同口径（**必含符号名**）。 */
function makeUnimplementedStub(name: string): () => never {
  return function unimplementedSymbol(): never {
    throw new Error(
      `EJS 模板用了本插件尚未实现的符号「${name}」：不再静默返回 undefined，改为显式抛错。`,
    );
  };
}

/** YAML 路径 → iframe 可 `import()` 的绝对 URL（相对路径按宿主页面解析）。 */
function resolveYamlUrl(path: unknown): string | null {
  const raw = typeof path === "string" && path.trim() ? path.trim() : DEFAULT_YAML_PATH;
  try {
    return new URL(raw, window.location.href).href;
  } catch {
    return raw;
  }
}

/**
 * 组装 srcdoc：**没有任何 module 脚本**，全部是普通 `<script>`。
 *
 * bootstrap 的职责：装错误缓冲 → 内联 `escapeFn`（`engine/escape.ts` 的 `escapeXML` 源码，
 * 该函数刻意保持自包含，见其文件头）→ 内联 `rethrow`（上游 `ejs.js:341-363` 同语义）→
 * 预加载 YAML → 监听 `run` 消息 → 用**合并视图 + 7 符号**装配 locals → 逐个执行 → 回传结果
 * → 最后发 `ready` 握手。
 */
function buildCarrierHtml(nonce: string, targetOrigin: string): string {
  // ⚠️ `escapeXML` 必须保持"源码自包含"（不得引用模块级符号），否则内联进 iframe 会 ReferenceError。
  const escapeSource = escapeXML.toString();
  const bootstrap = `(function () {
  var NONCE = ${JSON.stringify(nonce)};
  var TARGET = ${JSON.stringify(targetOrigin)};
  var ORIGIN = ${JSON.stringify(resolveTargetOrigin())};
  var DEFAULT_YAML_PATH = ${JSON.stringify(DEFAULT_YAML_PATH)};
  var MAX_ERROR = ${MAX_ERROR_CHARS};
  var errors = [];
  window.__nyaEjsErrors = errors;
  window.__nyaEjsFns = window.__nyaEjsFns || Object.create(null);

  function note(message) {
    try {
      errors.push({ message: String(message).slice(0, MAX_ERROR), at: Date.now() });
      while (errors.length > 20) errors.shift();
    } catch (e) { /* 错误缓冲自身失败不再抛 */ }
  }
  window.addEventListener('error', function (event) {
    note(event && event.message ? event.message : 'script error');
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event ? event.reason : null;
    note('unhandledrejection: ' + ((reason && reason.message) ? reason.message : String(reason)));
  });

  // escapeFn：与 engine/escape.ts 的 escapeXML 同源（父窗口把其源码内联进来）。
  var escapeFn = ${escapeSource};

  // rethrow：上游 ejs.js:341-363 同语义（±3 行上下文 + " >> " 标记当前行）。
  function rethrow(err, str, flnm, lineno, esc) {
    var lines = String(str === undefined || str === null ? '' : str).split('\\n');
    var start = Math.max(lineno - 3, 0);
    var end = Math.min(lines.length, lineno + 3);
    var filename = esc ? esc(flnm) : '';
    var context = lines.slice(start, end).map(function (line, index) {
      var current = index + start + 1;
      return (current === lineno ? ' >> ' : '    ') + current + '| ' + line;
    }).join('\\n');
    err.path = filename;
    err.message = (filename || 'ejs') + ':' + lineno + '\\n' + context + '\\n\\n' + err.message;
    throw err;
  }

  // include 的**运行期兜底**（NG 不做文件包含；compile.ts 已在编译期对 include( 抛错）。
  // ⚠️ 实践中模板里的 include 会被 with (locals || {}) 优先解析到 env 的同名抛错桩
  //    （UNIMPLEMENTED_ENV_SYMBOLS 含 'include'），这里是"env 万一缺了 include"的第二道保险，
  //    避免退化成 TypeError: include is not a function 这种不含符号语义的报错。
  function includeFallback() {
    throw new Error('EJS 模板用了本插件未实现的符号「include」：不支持文件包含（NG）。');
  }

  function bridgeSlot() {
    try {
      var carriers = window.parent && window.parent.__nyaEjsCarriers;
      return (carriers && carriers[NONCE]) || null;
    } catch (e) {
      return null;
    }
  }

  function messageOf(err) {
    if (err === undefined || err === null) return '未知错误';
    if (typeof err === 'string') return err;
    var name = err.name ? err.name + ': ' : '';
    var message = err.message ? err.message : String(err);
    return name + message;
  }

  // ─────────────────────────── YAML（宿主自托管产物，由本 iframe 自行 import）───────────────────────────
  var yamlUrl = null;
  var yamlPromise = null;
  var yamlValue = null;
  var yamlFailure = null;

  function ensureYaml(url) {
    if (typeof url === 'string' && url && url !== yamlUrl) {
      yamlUrl = url;
      yamlPromise = null;
      yamlValue = null;
      yamlFailure = null;
    }
    if (!yamlUrl) return Promise.resolve(null);
    if (yamlPromise) return yamlPromise;
    yamlPromise = import(yamlUrl).then(function (mod) {
      var candidate = mod && typeof mod.stringify === 'function' ? mod : (mod ? mod.default : null);
      if (!candidate || typeof candidate.stringify !== 'function') {
        throw new Error('YAML 产物不含 stringify：' + yamlUrl);
      }
      yamlValue = candidate;
      return candidate;
    }, function (err) {
      yamlFailure = messageOf(err);
      note('YAML 加载失败（用到 YAML 的条目会显式失败）: ' + yamlFailure);
      return null;
    });
    return yamlPromise;
  }

  function yamlOrStub() {
    if (yamlValue) return yamlValue;
    var reason = yamlFailure || (yamlUrl ? '尚未加载完成' : '宿主未提供 vendor.yamlPath');
    var thrower = function () { throw new Error('YAML 不可用：' + reason); };
    try {
      return new Proxy({}, { get: function () { return thrower; } });
    } catch (e) {
      return { stringify: thrower, parse: thrower };
    }
  }

  // ─────────────────────────── 环境装配（7 符号；数据面已在父窗口 realm 备好）───────────────────────────
  function storeOf(payload, scope) {
    var scopes = payload.scopes || {};
    if (scope === 'chat' || scope === 'local') return scopes.chat || {};
    if (scope === 'global') return scopes.global || {};
    // 缺省 / 'cache' / 'message' ⇒ 合并视图。
    // ⚠️ 'message' 也走视图是**有意的**：上游 getVariable 在 scope:'message' 且未传
    //    withMsg 时读的正是 STATE.cacheVars（variables.ts:475-482），而 getMessageVar
    //    就是 scope:'message'（ejs.ts:285）⇒ 与 getvar 同源；P0 黄金基准的桩 env 也是
    //    getvar === getMessageVar 读同一棵树。只有这样才能保证"同一条目内 setvar 后
    //    getMessageVar 立刻可读"（实测调用形态：setvar + getvar/getMessageVar 混用）。
    return payload.view || {};
  }

  function normalizeScope(scope) {
    if (scope === 'message' || scope === 'chat' || scope === 'local' || scope === 'global') return scope;
    return 'message';
  }

  function assertScopeSupported(scope) {
    if (scope === 'initial' || scope === 'shared') {
      throw new Error(
        'EJS 模板用了本插件没有对应物的作用域 scope:「' + scope + '」（NyaaChat 只有 message/chat/global）'
      );
    }
  }

  function buildLocals(payload, writes) {
    var view = payload.view || {};
    var lodash = payload.lodash;
    var lorebook = payload.lorebook || {};
    var messageId = payload.messageId === undefined ? 'latest' : payload.messageId;

    // 路径读：优先用 lodash 子集（与黄金基准的 _.get 同语义）；缺 lodash 时退化为逐段下钻。
    function readAt(store, key, defaults) {
      if (lodash && typeof lodash.get === 'function') {
        var value = lodash.get(store, key);
        return value === undefined ? defaults : value;
      }
      var direct = store;
      var segments = String(key).split('.');
      for (var i = 0; i < segments.length && direct != null; i++) direct = direct[segments[i]];
      return direct === undefined ? defaults : direct;
    }

    function getvar(key, options) {
      var opts = options && typeof options === 'object' ? options : {};
      assertScopeSupported(opts.scope);
      var store = storeOf(payload, opts.scope);
      if (key === undefined || key === null || key === '') return store;
      return readAt(store, key, opts.defaults);
    }

    function getMessageVar(key, options) {
      var opts = options && typeof options === 'object' ? options : {};
      assertScopeSupported(opts.scope);
      var store = storeOf(payload, 'message');
      if (key === undefined || key === null || key === '') return store;
      return readAt(store, key, opts.defaults);
    }

    function writeAt(key, value, options) {
      var opts = options && typeof options === 'object' ? options : {};
      assertScopeSupported(opts.scope);
      var scope = normalizeScope(opts.scope);
      if (typeof key === 'string' && key) {
        var store = scope === 'message' ? view : storeOf(payload, scope);
        if (lodash && typeof lodash.set === 'function') lodash.set(store, key, value);
        var intent = { path: key, value: value, scope: scope };
        if (scope === 'message') intent.messageId = messageId;
        writes.push(intent);
      }
      return undefined;
    }

    function getwi(name) {
      var key = name === undefined || name === null ? '' : String(name);
      if (Object.prototype.hasOwnProperty.call(lorebook, key)) return Promise.resolve(lorebook[key]);
      var trimmed = key.trim();
      if (trimmed !== key && Object.prototype.hasOwnProperty.call(lorebook, trimmed)) {
        return Promise.resolve(lorebook[trimmed]);
      }
      return Promise.resolve(null);
    }

    var env = {
      getvar: getvar,
      getMessageVar: getMessageVar,
      setvar: function (key, value, options) { return writeAt(key, value, options); },
      setMessageVar: function (key, value, options) {
        var opts = options && typeof options === 'object' ? Object.assign({}, options, { scope: 'message' }) : { scope: 'message' };
        return writeAt(key, value, opts);
      },
      getwi: getwi,
      YAML: yamlOrStub(),
      _: lodash
    };

    // 未实现符号桩（D11）：调用即显式抛错、文案含符号名；不覆盖上面已实现的 7 项。
    var stubs = payload.unimplemented || {};
    for (var name in stubs) {
      if (!Object.prototype.hasOwnProperty.call(env, name) && typeof stubs[name] === 'function') {
        env[name] = stubs[name];
      }
    }
    return env;
  }

  // ─────────────────────────── 执行 ───────────────────────────
  function failure(id, message) {
    var text = String(message === undefined || message === null ? '' : message).slice(0, MAX_ERROR);
    return { id: id, ok: false, text: '', error: text, errors: text ? [text] : [], writes: [] };
  }

  function runOne(job, env, writes) {
    var fn = window.__nyaEjsFns[job.hash];
    if (typeof fn !== 'function') {
      return failure(job.id, '模板函数未注册（templateHash=' + job.hash + '）');
    }
    var start = writes.length;
    var pending;
    try {
      // 参数表与 engine/compile.ts 的产物约定逐字一致：locals, escapeFn, include, rethrow
      // （body 即函数体 ⇒ 天然支持顶层 return 与 await，无需额外 IIFE 包裹）
      pending = fn(env, escapeFn, includeFallback, rethrow);
    } catch (err) {
      return failure(job.id, messageOf(err));
    }
    return Promise.resolve(pending).then(function (text) {
      var output = text === undefined || text === null ? '' : (typeof text === 'string' ? text : String(text));
      return { id: job.id, ok: true, text: output, errors: [], writes: writes.slice(start) };
    }, function (err) {
      return failure(job.id, messageOf(err));
    });
  }

  function runBatch(batchId, jobs) {
    var slot = bridgeSlot();
    var payload = slot && slot.env ? slot.env : null;
    if (!payload) {
      var degraded = [];
      for (var k = 0; k < jobs.length; k++) degraded.push(failure(jobs[k].id, '载体未收到 env 载荷'));
      post({ type: 'result', batchId: batchId, results: degraded });
      return;
    }
    ensureYaml(payload.yamlUrl).then(function () {
      var writes = [];
      var env = buildLocals(payload, writes);
      var results = [];
      var chain = Promise.resolve();
      for (var i = 0; i < jobs.length; i++) {
        (function (job) {
          chain = chain.then(function () { return runOne(job, env, writes); }).then(function (result) {
            results.push(result);
          });
        })(jobs[i]);
      }
      chain.then(function () {
        post({ type: 'result', batchId: batchId, results: results });
      });
    }, function (err) {
      // ensureYaml 内部已把失败吃掉；这里只兜底 Promise 链的意外中断
      var failed = [];
      for (var j = 0; j < jobs.length; j++) failed.push(failure(jobs[j].id, 'env 装配失败：' + messageOf(err)));
      post({ type: 'result', batchId: batchId, results: failed });
    });
  }

  // 结构化克隆失败时的可移植投影（函数/Symbol → 字符串，Date → ISO，深度上限）。
  function portable(value, depth) {
    if (depth > 8) return null;
    var type = typeof value;
    if (value === null || type === 'string' || type === 'number' || type === 'boolean' || type === 'undefined') {
      return value;
    }
    if (type !== 'object') return String(value);
    if (Array.isArray(value)) {
      var list = [];
      for (var i = 0; i < value.length; i++) list.push(portable(value[i], depth + 1));
      return list;
    }
    if (Object.prototype.toString.call(value) === '[object Date]') {
      try { return value.toISOString(); } catch (e) { return null; }
    }
    var out = {};
    for (var key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        var item = portable(value[key], depth + 1);
        if (item !== undefined) out[key] = item;
      }
    }
    return out;
  }

  function post(message) {
    message.__nyaEjsCarrier = NONCE;
    try {
      window.parent.postMessage(message, TARGET);
    } catch (err) {
      try {
        window.parent.postMessage(portable(message, 0), TARGET);
      } catch (err2) {
        note('回传结果失败: ' + ((err2 && err2.message) || String(err2)));
      }
    }
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || typeof data !== 'object' || data.__nyaEjsCarrier !== NONCE) return;
    if (data.type !== 'run') return;
    var jobs = data.jobs && data.jobs.length ? data.jobs : [];
    runBatch(String(data.batchId || ''), jobs);
  });

  // 握手后立刻预热 YAML（默认路径）：避免首次渲染被 100KB 的 vendor 产物阻塞。
  if (ORIGIN && ORIGIN !== 'null' && ORIGIN !== '*') {
    ensureYaml(ORIGIN + DEFAULT_YAML_PATH);
  }
  post({ type: 'ready' });
})();`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>ejs-template carrier</title>
</head>
<body>
<script>${bootstrap}</script>
</body>
</html>`;
}

function normalizeTimeout(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.max(50, Math.floor(value));
  }
  return DEFAULT_TIMEOUT_MS;
}

function createNonce(): string {
  return "nya-ejs-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
}

/**
 * `postMessage` 的 targetOrigin：同源 srcdoc 的 origin 继承自父窗口；
 * `file://` 等场景下 `location.origin` 是字符串 `"null"`，此时退回 `"*"`，
 * 接收侧仍以 `event.source === iframe.contentWindow` + nonce 双重校验兜底。
 */
function resolveTargetOrigin(): string {
  try {
    const origin = window.location.origin;
    return origin && origin !== "null" ? origin : "*";
  } catch {
    return "*";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asStringRecord(value: unknown): Record<string, string> {
  const source = asRecord(value);
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(source)) {
    if (typeof item === "string") {
      out[key] = item;
    }
  }
  return out;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

/** 深拷贝视图/作用域副本（父窗口 realm）——用 `lodashSubset.cloneDeep` 保住循环引用安全。 */
function deepCopy<T>(value: T): T {
  try {
    return lodashSubset.cloneDeep(value);
  } catch {
    return value;
  }
}

function bounded(message: string): string {
  const text = String(message == null ? "" : message);
  return text.length > MAX_ERROR_CHARS ? text.slice(0, MAX_ERROR_CHARS) + "…(截断)" : text;
}

function toText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return "";
  }
  return String(value);
}

function toWrites(value: unknown): PromptTextWrite[] {
  return Array.isArray(value) ? (value as PromptTextWrite[]) : [];
}

/** iframe 侧错误文案：优先 `error`，缺则合并 `errors[]`（见文件头协议 §3）。 */
function wireErrorText(wire: WireResult): string {
  const single = bounded(toText(wire.error));
  if (single) {
    return single;
  }
  const list = Array.isArray(wire.errors) ? wire.errors.map((item) => toText(item)).filter(Boolean) : [];
  return list.length ? bounded(list.join(" / ")) : "";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
