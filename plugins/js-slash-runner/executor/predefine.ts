/**
 * 脚本宿主 iframe 的「预置脚本」与 `tavern_events` 常量表（SSOT §2.4 / §4 / §2.7）。
 *
 * 本文件只**生成字符串**（要被塞进 srcdoc 的 JS 文本），不接触 DOM。生成时**不使用
 * 反引号与 `${}`**，避免与外层模板字符串冲突。
 *
 * 脚本可见的 API 全部是薄壳：真正实现由宿主窗口上的
 * `window.parent.__nyaScriptHostBridge` 提供（同源 ⇒ 直接调用门面对象）。
 */

/** `tavern_events` 常量表。**必须完整定义**，即使宿主暂时不发射 ——
 *  否则脚本拿到 `undefined` 事件名会静默永不触发（M6）。 */
export const TAVERN_EVENTS: Record<string, string> = {
  APP_READY: "app_ready",
  EXTRAS_CONNECTED: "extras_connected",
  MESSAGE_SENT: "message_sent",
  MESSAGE_RECEIVED: "message_received",
  MESSAGE_EDITED: "message_edited",
  MESSAGE_DELETED: "message_deleted",
  MESSAGE_UPDATED: "message_updated",
  MESSAGE_SWIPED: "message_swiped",
  MESSAGE_FILE_EMBEDDED: "message_file_embedded",
  MESSAGE_REASONING_EDITED: "message_reasoning_edited",
  MESSAGE_REASONING_DELETED: "message_reasoning_deleted",
  MESSAGE_SWIPE_DELETED: "message_swipe_deleted",
  MESSAGE_RENDERED: "character_message_rendered",
  CHARACTER_MESSAGE_RENDERED: "character_message_rendered",
  USER_MESSAGE_RENDERED: "user_message_rendered",
  GENERATION_STARTED: "generation_started",
  GENERATION_STOPPED: "generation_stopped",
  GENERATION_ENDED: "generation_ended",
  GENERATION_AFTER_COMMANDS: "generation_after_commands",
  CHAT_CHANGED: "chat_id_changed",
  CHAT_COMPLETION_SETTINGS_READY: "chat_completion_settings_ready",
  CHAT_COMPLETION_PROMPT_READY: "chat_completion_prompt_ready",
  CHARACTER_EDITED: "character_edited",
  CHARACTER_DELETED: "character_deleted",
  CHARACTER_DUPLICATED: "character_duplicated",
  CHARACTER_RENAMED: "character_renamed",
  CHARACTER_CHANGED: "character_changed",
  WORLDINFO_UPDATED: "worldinfo_updated",
  WORLDINFO_ACTIVATED: "worldinfo_activated",
  SETTINGS_UPDATED: "settings_updated",
  SETTINGS_LOADED: "settings_loaded",
  GROUP_UPDATED: "group_updated",
  MOVABLE_PANELS_RESET: "movable_panels_reset",
  /** MVU 的全局初始化（TauriTavern/JSR 约定，M7）。 */
  GLOBAL_MVU_INITIALIZED: "global_Mvu_initialized",
};

/** 宿主 `PluginEventName` → `tavern_events` 常量名。未列出的宿主事件不派发。 */
export const HOST_TO_TAVERN_EVENT: Record<string, string> = {
  "message:sent": "MESSAGE_SENT",
  "message:received": "MESSAGE_RECEIVED",
  "message:deleted": "MESSAGE_DELETED",
  "message:rendered": "CHARACTER_MESSAGE_RENDERED",
  "generation:started": "GENERATION_STARTED",
  "generation:stopped": "GENERATION_STOPPED",
  "session:changed": "CHAT_CHANGED",
  "character:changed": "CHARACTER_CHANGED",
  "worldinfo:updated": "WORLDINFO_UPDATED",
  "completion:settings-ready": "CHAT_COMPLETION_SETTINGS_READY",
};

/**
 * 预置脚本：在 iframe 内定义脚本可见的 API。
 * 依赖外层已按序加载 `_` / `$` / `toastr` / `YAML` / `z`。
 */
export function buildPredefineScript(): string {
  const events = JSON.stringify(TAVERN_EVENTS);
  return `
(function () {
  var bridge = window.parent.__nyaScriptHostBridge;
  if (!bridge) { console.error('[js-slash-runner] 宿主桥不存在，脚本 API 不可用'); return; }
  var api = bridge.api;

  var handlers = new Map();
  var globalInitialized = new Map();

  // ── 诊断探针（主页面一条命令 __nyaScriptRunnerDiag() 即可看到初始化期的真实事实）──
  // 背景：MVU 的 initvar 有两个**静默**退出点，且都只打同一句
  // runtime.initvar.noMessagesLog（真机原文「不存在任何一条消息，退出」）：
  //   ① SillyTavern.chat.length === 0（紧跟一句 toastr.error）
  //   ② try 块内抛错（该 catch **丢弃了错误对象**，devtools 里看不到原因）
  // 下面记录三件事，用来区分这两个分支（无需改 MVU 源码）：
  //   · 每次读 SillyTavern.chat 的长度/时刻  → 分支① 的直接证据
  //   · toastr.error 的调用记录              → 分支① 的旁证（分支② 不弹 toast）
  //   · iframe 内 console 的环形缓冲          → 那句日志的时刻与前后文
  window.__nyaShellProbe = { chatReads: 0, lastChatLen: null, lastChatAt: null, reads: [] };
  window.__nyaScriptConsole = [];
  window.__nyaToastrCalls = [];
  window.__nyaInstallProbes = function () {
    // ⚠️ 分两段装、各自幂等：console 段在**库加载之前**就要装（才能记到库加载错误），
    // 而 toastr 段必须等 toastr 库加载完之后**再调一次**才能装上（v11-1542 的
    // __nyaToastrCalls 一直是空数组，就是因为只在库加载前调了一次）。
    if (!window.__nyaProbesConsole) {
      window.__nyaProbesConsole = true;
      ['error', 'warn', 'info', 'log'].forEach(function (level) {
        var original = console[level];
        if (typeof original !== 'function') return;
        console[level] = function () {
          try {
            if (window.__nyaScriptConsole.length < 120) {
              var parts = [];
              for (var i = 0; i < arguments.length && i < 3; i++) {
                var v = arguments[i];
                try {
                  parts.push(typeof v === 'string' ? v : v && v.message ? String(v.message) : JSON.stringify(v));
                } catch (e) { parts.push('[unserializable]'); }
              }
              window.__nyaScriptConsole.push({ lv: level, t: Math.round(performance.now()), m: parts.join(' ').slice(0, 400) });
            }
          } catch (e) { /* 探针绝不能影响主流程 */ }
          return original.apply(console, arguments);
        };
      });
    }
    if (window.__nyaProbesToastr || !window.toastr) return;
    window.__nyaProbesToastr = true;
    ['error', 'warning', 'info', 'success'].forEach(function (level) {
      var original = window.toastr[level];
      if (typeof original !== 'function') return;
      window.toastr[level] = function () {
        try {
          if (window.__nyaToastrCalls.length < 40) {
            window.__nyaToastrCalls.push({ lv: level, t: Math.round(performance.now()), m: String(arguments.length ? arguments[0] : '').slice(0, 200) });
          }
        } catch (e) {}
        return original.apply(window.toastr, arguments);
      };
    });
  };

  function toHostOption(option) {
    option = option || {};
    var scope = option.type === 'chat' ? 'chat' : option.type === 'global' ? 'global' : 'message';
    var messageId = option.message_id;
    if (messageId === undefined || messageId === null) messageId = 'latest';
    var out = {};
    if (scope === 'message') out.messageId = messageId;
    if (option.type) out.scope = scope;
    return { scope: scope, option: out };
  }

  // ── 变量 API（M1/M2/M8）────────────────────────────────────────────────
  function getVariables(option) {
    var t = toHostOption(option);
    return api.variables.getVariables(t.scope, t.option);
  }
  function replaceVariables(vars, option) {
    var t = toHostOption(option);
    return api.variables.replaceVariables(vars, t.scope, t.option);
  }
  function updateVariablesWith(updater, option) {
    var t = toHostOption(option);
    return api.variables.updateVariablesWith(updater, t.scope, t.option);
  }
  function insertVariables(vars, option) {
    var t = toHostOption(option);
    return api.variables.insertVariables(vars, t.scope, t.option);
  }
  function deleteVariable(path, option) {
    var t = toHostOption(option);
    return api.variables.deleteVariable(path, t.scope, t.option);
  }
  function hasVariable(path, option) {
    var t = toHostOption(option);
    return api.variables.hasVariable(path, t.scope, t.option);
  }
  function getAllVariables() {
    return {
      global: api.variables.getVariables('global'),
      chat: api.variables.getVariables('chat'),
      message: api.variables.getVariables('message', { messageId: 'latest' }),
    };
  }

  // ── 消息 API（M3/M4/M5）────────────────────────────────────────────────
  function normalizeRange(range) {
    var last = api.messages.getLastId();
    if (range === undefined || range === null) return [last];
    if (typeof range === 'number') return [range < 0 ? last + 1 + range : range];
    if (range === 'latest') return [last];
    if (Array.isArray(range)) {
      if (range.length === 2 && typeof range[0] === 'number' && typeof range[1] === 'number') {
        var out = [];
        for (var i = range[0]; i <= range[1]; i++) out.push(i);
        return out;
      }
      return range.slice();
    }
    if (typeof range === 'object') {
      var start = range.start === undefined ? 0 : range.start;
      var end = range.end === undefined ? last : range.end;
      var list = [];
      for (var j = start; j <= end; j++) list.push(j);
      return list;
    }
    return [last];
  }

  function getChatMessages(range, option) {
    option = option || {};
    var msgs = api.messages.getAll();
    var ids = normalizeRange(range);
    var result = [];
    for (var i = 0; i < ids.length; i++) {
      var index = ids[i];
      var m = msgs[index];
      if (!m) continue;
      var swipes = Array.isArray(m.variables) ? m.variables : [];
      var data = swipes[0] || {};
      result.push({
        message_id: index,
        role: m.role,
        name: m.role === 'user' ? api.identity.user : api.identity.char,
        message: m.content,
        data: data,
        swipes_data: swipes.length ? swipes : [{}],
        swipes_id: swipes.map(function (_, k) { return k; }),
        // ⚠️ MVU 的 initvar 在"只有开场白（message 0）"分支里走的是
        //   getChatMessages(0,{include_swipes:true})[0].swipes.map(...)
        // 用**文本数组**去匹配 <initvar> 块。缺这个字段 ⇒ swipes.map 抛错 ⇒ 整条初始化链
        // 静默中断（Zt 的调用点没有 catch）。NyaaChat 每条消息只有一条 swipe ⇒ 单元素数组。
        swipes: [m.content],
        swipe_id: 0,
      });
    }
    // 探针：记录最近一次返回（MVU 的 jo/Yt 都拿它做门控 —— jo 里有
    //   o.name !== SillyTavern.name2 与 o.message.length 两道静默 return）。
    try {
      var probe = window.__nyaShellProbe;
      if (probe) {
        var lastOne = result.length ? result[result.length - 1] : null;
        probe.lastChatMsg = lastOne
          ? {
              id: lastOne.message_id,
              role: lastOne.role,
              name: lastOne.name,
              name2: window.SillyTavern ? window.SillyTavern.name2 : null,
              len: lastOne.message ? String(lastOne.message).length : 0,
            }
          : null;
      }
    } catch (e) { /* 探针绝不能影响主流程 */ }
    return result;
  }

  function setChatMessages(updates) {
    if (!Array.isArray(updates)) return;
    api.messages.update(function (messages) {
      var next = messages.slice();
      for (var i = 0; i < updates.length; i++) {
        var u = updates[i];
        if (!u) continue;
        var index = u.message_id === 'latest' ? next.length - 1 : u.message_id;
        if (typeof index !== 'number' || index < 0 || index >= next.length) continue;
        var current = next[index];
        var patch = {};
        var allowed = ['message', 'variables', 'data', 'swipes_data'];
        for (var k = 0; k < allowed.length; k++) {
          if (Object.prototype.hasOwnProperty.call(u, allowed[k])) patch[allowed[k]] = u[allowed[k]];
        }
        var unsupported = Object.keys(u).filter(function (key) {
          return ['message_id'].concat(allowed).indexOf(key) === -1 && u[key] !== undefined;
        });
        if (unsupported.length) {
          console.error('[js-slash-runner] setChatMessages 收到 V1 未支持的字段：' + unsupported.join(', '));
        }
        var vars = patch.variables !== undefined ? patch.variables
          : patch.data !== undefined ? patch.data
          : patch.swipes_data !== undefined && patch.swipes_data.length ? patch.swipes_data[0]
          : undefined;
        // ⚠️ 必须把 ST 的 message 字段映射到我们的 content：MVU 的两个收尾路径都用它改写正文 ——
        //   · Yt（楼层变量落地后）给回复**追加 StatusPlaceHolderImpl 占位符**（状态栏用的就是它！）
        //   · pn（额外模型解析/JSONPatch）把 UpdateVariable 块追加到正文
        // 不映射的后果（真机可复现）：改写被写成一条无用的 message 属性、content 不变
        // ⇒ 正文里永远没有占位符 ⇒ 每轮回复都没有状态栏。
        if (patch.message !== undefined) {
          patch.content = patch.message;
          delete patch.message;
        }
        if (vars !== undefined) patch.variables = [vars];
        delete patch.data;
        delete patch.swipes_data;
        next[index] = Object.assign({}, current, patch);
      }
      return next;
    });
  }

  function getLastMessageId() { return api.messages.getLastId(); }

  // ── 事件（M6/M7）──────────────────────────────────────────────────────
  function eventOn(name, handler) {
    if (typeof handler !== 'function') return;
    if (!handlers.has(name)) handlers.set(name, new Set());
    handlers.get(name).add(handler);
  }
  function eventRemoveListener(name, handler) {
    if (handlers.has(name)) handlers.get(name).delete(handler);
  }
  // ⚠️ 酒馆语义：eventEmit(event, ...args) —— 处理器收到的是**同样的一串参数**。
  // 早先这里只转发第一个参数，直接把 MVU/mvu_zod 之间的多参数事件打断（真机 v12-1753：
  // MVU 用 eventEmit(VARIABLE_INITIALIZED, a, o) 发两个参数，zod 侧处理器拿到 undefined，
  // 报 "Cannot read properties of undefined (reading 'forEach')" /
  // "Cannot set properties of undefined (setting 'length')"）。
  function eventEmit(name) {
    var args = Array.prototype.slice.call(arguments, 1);
    // 探针：记录"派发了什么事件、有几个处理器"——用来区分「事件没进 iframe」/
    // 「MVU 没注册处理器」/「处理器跑了但内部门控没开」（真机排查 message_received 用）。
    try {
      var probe = window.__nyaShellProbe;
      if (probe) {
        probe.events = probe.events || {};
        var size = handlers.has(name) ? handlers.get(name).size : 0;
        var rec = probe.events[name] || { n: 0, handlers: size, last: null };
        rec.n++;
        rec.handlers = size;
        try { rec.last = String(args[0]).slice(0, 40); } catch (e) {}
        rec.args = args.length;
        probe.events[name] = rec;
      }
    } catch (e) { /* 探针绝不能影响主流程 */ }
    if (!handlers.has(name)) return;
    handlers.get(name).forEach(function (h) {
      try { h.apply(null, args); } catch (e) { console.error('[js-slash-runner] 事件处理器抛错 ' + name, e); }
    });
  }

  window.__nyaDispatch = function (name) {
    var args = Array.prototype.slice.call(arguments, 1);
    eventEmit.apply(null, [name].concat(args));
    if (globalInitialized.has(name)) {
      globalInitialized.get(name).forEach(function (resolve) { resolve(); });
      globalInitialized.delete(name);
    }
  };

  // ── 全局初始化握手（M7）───────────────────────────────────────────────
  function waitGlobalInitialized(name) {
    var key = String(name);
    if (key === 'Mvu' && typeof window.Mvu !== 'undefined' && window.Mvu) return Promise.resolve();
    return new Promise(function (resolve) {
      if (!globalInitialized.has(key)) globalInitialized.set(key, []);
      globalInitialized.get(key).push(resolve);
    });
  }
  function initializeGlobal(name, value) {
    var key = String(name);
    try { window[key] = value; } catch (e) { window[key] = value; }
    try { window.parent[key] = value; } catch (e) { /* 跨源时忽略（本实现同源） */ }
    eventEmit(String(TAVERN_EVENTS.GLOBAL_MVU_INITIALIZED), value);
    window.__nyaDispatch(String(TAVERN_EVENTS.GLOBAL_MVU_INITIALIZED), value);
  }

  // ── 其它（M10/M11/M12）───────────────────────────────────────────────
  function substitudeMacros(text) { return api.macros.substitute(String(text == null ? '' : text)); }
  function getCurrentPersonaName() { return api.identity.user; }
  function getCurrentCharName() { return api.identity.char; }

  // ── D9 实测校准（t24 第二轮，真机 error/warning 原文）：MVU 初始化路径上真实缺失的
  //    裸全局。上一轮补齐 SillyTavern 壳后，真机报的是这两个名字（不是"猜"出来的）：
  //      [error] ReferenceError: insertOrAssignVariables is not defined
  //      [warning] jQuery.Deferred exception: appendInexistentScriptButtons is not defined
  // ① insertOrAssignVariables：MVU store 里 watch(()=>…, e => insertOrAssignVariables(…),
  //    {immediate:true}) ⇒ **同步**调用 ⇒ 未定义即抛 ⇒ store setup 中断 ⇒ window.Mvu
  //    永不出现。JSR 语义=插入或覆盖给定作用域的顶层键 ⇒ 等价宿主 insertVariables。
  function insertOrAssignVariables(vars, option) {
    var t = toHostOption(option);
    return api.variables.insertVariables(vars || {}, t.scope, t.option);
  }
  // ② 脚本按钮一族：MVU 初始化第二步会调用 appendInexistentScriptButtons /
  //    getScriptButtons / replaceScriptButtons / getButtonEvent。本期不做脚本按钮 UI
  //    （D9），但它们**必须存在且不抛错**，否则初始化第二步整个中断。
  var scriptButtons = [];
  function getScriptButtons() { return scriptButtons.slice(); }
  function appendInexistentScriptButtons(buttons) {
    try { if (Array.isArray(buttons)) scriptButtons = scriptButtons.concat(buttons); } catch (e) {}
  }
  function replaceScriptButtons(buttons) {
    try { scriptButtons = Array.isArray(buttons) ? buttons.slice() : []; } catch (e) { scriptButtons = []; }
    return scriptButtons.slice();
  }
  // 事件名必须是**字符串**：MVU 会把它交给 eventOn(name, fn) 注册按钮回调。
  function getButtonEvent(name) { return 'nya_script_button_clicked::' + String(name); }
  // ③ getCharWorldbookNames：MVU 读"角色世界书绑定"用（真机 error 原文
  //    [MVU]读取角色世界书绑定失败 ReferenceError: getCharWorldbookNames is not defined）。
  //    直接映射门面已有的 getCharLorebooks() 形状 { primary, additional }。
  function getCharWorldbookNames() { return api.lorebook.getCharLorebooks(); }
  // ④ 世界书名字适配（真机 error 原文：[MVU]读取角色卡配置失败 Error: 无法读取角色世界书"T7 验证角色"）。
  //    门面当前把 getCharLorebooks().primary 简化成 null、getLorebookSettings() 也没有
  //    world_info.character ⇒ MVU 按"角色名"去找书时找不到。这里在**脚本可见层**
  //    （predefine）把"角色主世界书名"补成角色名，并保留 getEntries 的门面行为
  //    （它对任意书名声都返回当前角色条目）—— 不改门面契约。
  //    ⚠️ 已登记：若 captain 认为应在门面侧补齐 primary / world_info.character，可撤掉本适配。
  function currentLorebookName() {
    try { return api.character && api.character.getName ? (api.character.getName() || 'character') : 'character'; }
    catch (e) { return 'character'; }
  }

  // ⚠️ 当前聊天 id —— 与 SillyTavern.getCurrentChatId() **必须同源**，因为 MVU 的初始化
  //    谓词是 n === a && SillyTavern.getCurrentChatId() === e（e = CHAT_CHANGED 事件的载荷）。
  //    早先这里固定返回 null、而 CHAT_CHANGED 载荷是 {} / {sessionId,...} 对象
  //    ⇒ null === 对象 恒为 false ⇒ MVU 走 (await o(), await Ps(t), []) 分支
  //    **把刚注册的事件处理器全部摘掉且不再重注册**（真机 v12-1707 实证：
  //    message_received 派发到了 iframe，但 handlers:0 ⇒ 回复楼层拿不到变量、
  //    状态栏占位符永不追加）。
  function currentChatId() {
    try {
      var diag = api.messages && api.messages.diagnostics ? api.messages.diagnostics() : null;
      return (diag && diag.sessionId) || 'nyaachat-unsaved';
    } catch (e) { return 'nyaachat-unsaved'; }
  }
  window.__nyaChatId = currentChatId;
  // 必须**基于门面**再补 world_info.character，不能整体替换：早先这里返回的是自造对象，
  // 把门面里 MVU 真正需要的字段（selected_global_lorebooks 等）整个丢掉了
  // 导致 MVU 报 selected_global_lorebooks is not iterable（真机 + 源码定位）。
  function getLorebookSettings() {
    var base = api.lorebook.getSettings();
    try {
      base.world_info = { global: null, character: currentLorebookName() };
    } catch (e) {}
    return base;
  }
  function getCharLorebooks() { return { primary: currentLorebookName(), additional: [] }; }
  function getLorebookEntries(name) { return api.lorebook.getEntries(name); }

  // ── D9 校准（t24 真机实测新增）：getTavernHelperVersion ────────────────────
  // MVU 的 store 里是 _wait_init: async () => { …; p.value.tavernhelper = await
  // getTavernHelperVersion() }（bundle.js 内 _wait_init 字段原文）。它在
  // UNIMPLEMENTED 里 ⇒ 抛错 ⇒ 该 await 永不 resolve ⇒ 初始化停摆 ⇒ window.Mvu
  // 始终不存在 + 脚本元素 30s 超时（真机实测的第三层根因）。
  // 返回值刻意**低于** MVU 已知的三处版本门槛（4.0.14 / 4.8.4 / 4.8.13）：
  //   · additional_extra_configuration_supported = compare(v,'4.0.14','>=') → false
  //   · en()（function calling 支持判定，'4.8.4'）→ 走"不支持"分支（仅文案）
  //   · ho()（pi 多供应商，'4.8.13'）→ false
  // ⇒ MVU 走**核心变量管线**，而本期明确不支持的子系统保持关闭。
  // 将来要让某子系统上线，请连同它依赖的 API 一起实现后再抬高此值。
  function getTavernHelperVersion() { return '4.0.13'; }

  // ── D9 校准（真机实测，不是猜测）─────────────────────────────────────────
  // mvu_zod 在初始化路径上**真实调用** registerVariableSchema：
  //   if ('function'==typeof registerVariableSchema)
  //     registerVariableSchema(z.object({ stat_data: e }), { type: 'message' });
  // 之所以以前会炸，是因为我们的"显式抛错桩"**本身是个函数**，typeof 守卫放行后才抛。
  // 官方文档明确该 API 是**纯 UI 行为**（只影响变量管理器显示，对代码层面无影响），
  // 而 NyaaChat 本期不做变量管理器（D2 / NG5）⇒ 记录 + 不抛错。
  var variableSchemas = new Map();
  function registerVariableSchema(schema, option) {
    try {
      variableSchemas.set((option && option.type) || 'message', schema);
    } catch (e) { /* 记录失败也绝不能炸脚本 */ }
  }

  // ── SillyTavern 兼容壳（MVU 的 webpack externals 之外的硬依赖）────────────
  // 真机根因：mvu/bundle.js:2:343395 原文是
  //   const wt = _.debounce(SillyTavern.saveChat, 1e3);
  // 我们原先只给 { name1, name2 } ⇒ _.debounce(undefined) 在**模块求值期**抛
  // TypeError: Expected a function ⇒ 整个 bundle 求值失败 ⇒ window.Mvu 永不出现。
  // 通行做法：门面已有的数据就真实现，没有的给**不抛错的最小桩**。
  function buildSillyTavernShell(a) {
    // 必须是稳定对象：MVU 会读 SillyTavern.extensionSettings 的 mvu_settings 并写回；每次返回新对象会让写入被丢弃（真机实测缺陷）。
    // ST 形状的世界书读取：MVU 的 Zo() 会校验 loadWorldInfo() 的返回值形状，
    // 拿到数组会抛「无法读取角色世界书」（真机实测）。ST 形状是
    // { entries: { [uid]: { uid, key[], keysecondary[], comment, content, disable, constant, ... } } }。
    function stWorldInfoEntries() {
      var out = {};
      var list = a.lorebook.getEntries();
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        out[String(i)] = {
          uid: i,
          key: String(e.keys || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean),
          keysecondary: [],
          comment: e.comment,
          content: e.content,
          disable: !e.enabled,
          constant: !!e.constant,
          selective: false,
          order: 100,
          position: e.position === 'assistant' ? 1 : 0,
        };
      }
      return out;
    }

    var shellExtensionSettings = {};
    var shellChatCompletionSettings = {};
    var shell = {
      name1: a.identity.user,
      name2: a.identity.char,
      get extensionSettings() { return shellExtensionSettings; },
      get chatCompletionSettings() { return shellChatCompletionSettings; },
      getRequestHeaders: function () { return {}; },
      // ⚠️ 必须是**函数**：MVU 把它交给 _.debounce（我们会话的持久化由宿主变量层负责）。
      saveChat: function () { try { a.messages.update(function (m) { return m; }); } catch (e) {} },
      saveSettingsDebounced: function () {},
      // ⚠️ 必须与 CHAT_CHANGED 事件的载荷**同源同值**（见 currentChatId 的注释）：
      //    MVU 的初始化谓词拿它和事件载荷做 === 比较，假就回滚全部事件处理器。
      // 探针：记录读取次数/时刻/值 —— jo 只读 2 次（开头 + 早退判定），走到 c() 守卫
      // 会多读；据此判定 jo 有没有走到调用 Yt 的那一行。
      getCurrentChatId: function () {
        var id = currentChatId();
        try {
          var probe = window.__nyaShellProbe;
          if (probe) {
            probe.chatIdReads = (probe.chatIdReads || 0) + 1;
            probe.chatIdValue = id;
            probe.chatIdHistory = (probe.chatIdHistory || []).concat([
              { t: Math.round(performance.now()), n: probe.chatIdReads, id: String(id).slice(0, 8) }
            ]).slice(-15);
          }
        } catch (e) { /* 探针绝不能影响主流程 */ }
        return id;
      },
      getCurrentLocale: function () { return 'zh-cn'; },
      getChatCompletionModel: function () { return ''; },
      getCharacterCardFields: function () { return {}; },
      loadWorldInfo: function () { return { entries: stWorldInfoEntries() }; },
      unregisterFunctionTool: function () {},
      ToolManager: { registerFunctionTool: function () {}, unregisterFunctionTool: function () {} },
      registerMacro: function () {},
      unregisterMacro: function () {},
      // 本期不做变量管理器 UI ⇒ 弹窗一律返回"取消/关闭"的安全值，绝不抛错。
      callGenericPopup: function () { return 0; },
      POPUP_TYPE: { TEXT: 1, CONFIRM: 2, INPUT: 3, DISPLAY: 4 },
      POPUP_RESULT: { AFFIRMATIVE: 1, NEGATIVE: 0, CANCELLED: null },
    };
    // ⚠️ chat 必须是 **live getter**（每次读现取），且元素形如
    // { variables: [...], swipe_id } —— MVU 用 _.get(e, ['variables', e.swipe_id ?? 0])
    // 读楼层变量；做成一次性快照会让它读到过期楼层。
    Object.defineProperty(shell, 'chat', {
      enumerable: true,
      get: function () {
        try {
          var list = a.messages.getAll().map(function (m) {
            var swipes = Array.isArray(m.variables) ? m.variables : [];
            return { variables: swipes.length ? swipes : [{}], swipe_id: 0, mes: m.content, is_user: m.role === 'user', name: m.role === 'user' ? a.identity.user : a.identity.char };
          });
          // 探针：记录"什么时候被读、读到几层"。MVU initvar 判空就是读这里。
          try {
            var probe = window.__nyaShellProbe;
            if (probe) {
              probe.chatReads++;
              probe.lastChatLen = list.length;
              probe.lastChatAt = Math.round(performance.now());
              if (probe.reads.length < 40) probe.reads.push({ n: list.length, t: probe.lastChatAt });
            }
          } catch (e) {}
          return list;
        } catch (e) { return []; }
      },
    });
    Object.defineProperty(shell, 'characters', {
      enumerable: true,
      get: function () { try { return []; } catch (e) { return []; } },
    });
    Object.defineProperty(shell, 'characterId', {
      enumerable: true,
      get: function () { try { return a.character.getId(); } catch (e) { return null; } },
    });
    return shell;
  }

  var implemented = {
    registerVariableSchema: registerVariableSchema,
    getTavernHelperVersion: getTavernHelperVersion,
    insertOrAssignVariables: insertOrAssignVariables,
    getScriptButtons: getScriptButtons,
    appendInexistentScriptButtons: appendInexistentScriptButtons,
    replaceScriptButtons: replaceScriptButtons,
    getButtonEvent: getButtonEvent,
    getCharWorldbookNames: getCharWorldbookNames,
    getVariables: getVariables,
    replaceVariables: replaceVariables,
    updateVariablesWith: updateVariablesWith,
    insertVariables: insertVariables,
    deleteVariable: deleteVariable,
    hasVariable: hasVariable,
    get_variables_without_clone: getVariables,
    getAllVariables: getAllVariables,
    getChatMessages: getChatMessages,
    setChatMessages: setChatMessages,
    getLastMessageId: getLastMessageId,
    eventOn: eventOn,
    eventEmit: eventEmit,
    eventRemoveListener: eventRemoveListener,
    substitudeMacros: substitudeMacros,
    getCurrentPersonaName: getCurrentPersonaName,
    getLorebookSettings: getLorebookSettings,
    // 本期不持久化世界书全局设置：接受并忽略，绝不抛错（MVU 会在不一致时回写）。
    setLorebookSettings: function () {},
    getCharLorebooks: getCharLorebooks,
    getLorebookEntries: getLorebookEntries,
    getCurrentCharName: getCurrentCharName,
    waitGlobalInitialized: waitGlobalInitialized,
    initializeGlobal: initializeGlobal,
    getScriptId: function () { return window.__nyaScriptId; },
    tavern_events: ${events}
  };

  // D9：未实现的 API **显式抛错**，绝不静默返回 undefined。
  var UNIMPLEMENTED = [
    'createChatMessages', 'deleteChatMessages', 'rotateChatMessages', 'refreshMessage',
    'triggerSlash', 'eventOnce', 'eventEmitAndWait', 'registerMacroLike', 'injectPrompts',
    'generate', 'generateRaw', 'stopGenerationById',
    'getVariablesByType', 'setVariablesByType'
  ];

  // ── 诊断探针（用户可不靠 devtools 定位"无报错的 30s 超时"）────────────────
  // 记录脚本调用过的宿主 API 序列；超时/报错时由 srcdocHost 附在错误信息里，
  // 直接显示在「扩展 → 脚本运行器 → 运行日志」中。上限 200 条，无副作用。
  window.__nyaApiCalls = [];
  Object.keys(implemented).forEach(function (name) {
    var fn = implemented[name];
    if (typeof fn !== 'function' || name === 'tavern_events') return;
    // 记录**参数 + 返回值 + 抛错**：MVU 的 initvar 把异常吞掉了，只有知道
    // getLastMessageId() 返回了什么、哪一步抛了，才能判断它走的是哪个退出分支。
    implemented[name] = function () {
      var rec = null;
      try {
        if (window.__nyaApiCalls.length < 200) {
          rec = { n: name, t: Math.round(performance.now()) };
          try {
            if (arguments.length > 0) rec.a = JSON.stringify(arguments[0]).slice(0, 120);
          } catch (e) { /* 循环引用 */ }
          window.__nyaApiCalls.push(rec);
        }
      } catch (e) { /* 探针绝不能影响主流程 */ }
      var out;
      try {
        out = fn.apply(null, arguments);
      } catch (err) {
        try { if (rec) rec.err = String((err && err.message) || err); } catch (e) {}
        throw err;
      }
      try {
        if (rec) {
          rec.r = out === null ? 'null'
            : Array.isArray(out) ? 'array[' + out.length + ']'
            : typeof out === 'object' ? 'object'
            : String(out);
        }
      } catch (e) {}
      return out;
    };
  });

  var target = {};
  Object.keys(implemented).forEach(function (key) { target[key] = implemented[key]; });
  UNIMPLEMENTED.forEach(function (name) {
    target[name] = function () {
      throw new Error('[js-slash-runner] V1 未实现：' + name);
    };
  });

  var proxy = new Proxy(target, {
    get: function (obj, prop) {
      if (prop in obj) return obj[prop];
      if (typeof prop === 'string' && /^(var_|extension_|preset_)/.test(prop)) {
        throw new Error('[js-slash-runner] V1 不支持的作用域 API：' + prop);
      }
      var missing = function () {
        throw new Error('[js-slash-runner] V1 未实现：' + String(prop));
      };
      return missing;
    }
  });

  // 全局暴露（脚本里是裸调用：getVariables(...)、eventOn(...)）
  var names = Object.keys(implemented);
  for (var i = 0; i < names.length; i++) window[names[i]] = implemented[names[i]];
  for (var j = 0; j < UNIMPLEMENTED.length; j++) {
    (function (name) {
      window[name] = function () { throw new Error('[js-slash-runner] V1 未实现：' + name); };
    })(UNIMPLEMENTED[j]);
  }
  // ⚠️ Mvu 全局的镜像（照 JSR predefine.js:36-40 的做法）：
  // MVU 脚本把 Mvu 挂在**父窗口**上（window.parent.Mvu），iframe 侧必须以 getter 镜像回来，
  // 并给一个空 setter（MVU 自己会 _.set 自己的变量）。我们原先只读 iframe 自己的同名属性
  // ⇒ 永远 undefined ⇒ global_Mvu_initialized 永不派发 ⇒ mvu_zod 的 waitGlobalInitialized
  // 永久挂起 ⇒ 两个脚本都 30s 超时（真机症状）。
  try {
    if (window.parent && window.parent !== window) {
      Object.defineProperty(window, 'Mvu', {
        configurable: true,
        get: function () { try { return window.parent.Mvu; } catch (e) { return undefined; } },
        set: function () { /* 空 set：与 JSR 一致 */ },
      });
    }
  } catch (e) { /* 定义失败也不能影响脚本执行 */ }

  window.tavern_events = implemented.tavern_events;
  window.TavernHelper = proxy;
  // SillyTavern 壳（见 buildSillyTavernShell：saveChat 必须是函数、chat 必须是 live getter）
  window.SillyTavern = buildSillyTavernShell(api);

  // MVU 会把 Mvu 挂到 iframe 的 globalThis；镜像到宿主窗口供其它脚本/卡片读取（M7）。
  window.__nyaSyncMvu = function () {
    if (typeof window.Mvu !== 'undefined' && window.Mvu) {
      try { window.parent.Mvu = window.Mvu; } catch (e) { /* ignore */ }
      window.__nyaDispatch(String(TAVERN_EVENTS.GLOBAL_MVU_INITIALIZED), window.Mvu);
      return true;
    }
    return false;
  };
})();
`;
}

/**
 * 卡片 iframe 的最小注入（D14）：MVU 的 View（状态栏）在**卡片 iframe** 里调用
 * `getAllVariables()`，因此那里也要有一份只读 + 变量宿主 API。
 * 与脚本宿主同源，直接走 `window.parent.__nyaScriptHostBridge`。
 */
export function buildCardPredefineScript(): string {
  const events = JSON.stringify(TAVERN_EVENTS);
  return `
(function () {
  // ⚠️ **绝不能**因为桥还没就绪就整体 return（真机 harness 实测的回归）：
  //    卡片 iframe 可能在插件 mount 之前就渲染（打开已有会话、重新渲染楼层、宿主重挂载），
  //    那时 window.parent.__nyaScriptHostBridge 还不存在。早先这里第一行就是"没有桥就直接
  //    return" ⇒ 卡片 iframe 里**一个 API 都没有** ⇒ 卡片自己的引导脚本立刻 ReferenceError
  //    （苏婷卡：$(errorCatched(init)) → "errorCatched is not defined"；道渊卡：
  //    "waitGlobalInitialized is not defined"），状态栏就停在"加载中… / --:--"。
  //    这与"变量没进来"是两回事：宿主 iframe 里 MVU 其实已经把 stat_data 写好了
  //    （同一份诊断快照里 setChatMessages / updateVariablesWith 都成功）。
  //    现在改为：**立即可装的全部先装**（不依赖桥），依赖桥的走动态 getter + 轮询，
  //    桥一到就补齐并广播一次 __nyaCardReady，让卡片有机会重画。
  function getBridge() {
    try { return window.parent.__nyaScriptHostBridge || null; } catch (e) { return null; }
  }
  function getApi() {
    var b = getBridge();
    return b ? b.api : null;
  }

  // ── 不依赖桥的部分（必须在卡片脚本执行前就位）──────────────────────────────
  // ST 侧辅助函数：MVU 卡片的引导脚本用 $(errorCatched(init)) 把它包起来。
  window.errorCatched = function (fn) {
    return function () {
      try { return fn.apply(this, arguments); }
      catch (e) { console.error('[js-slash-runner] errorCatched 捕获', e); }
    };
  };
  window.tavern_events = ${events};

  // 事件总线 + Mvu 镜像（MVU技术性说明 §4.6）：状态栏 View 的自动重绘靠
  // eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, redraw)；早先这里没有事件总线、也没有
  // Mvu ⇒ View 只在 iframe 加载时画一次初始快照，之后变量更新了也不重绘。
  var cardHandlers = new Map();
  window.eventOn = function (name, handler) {
    if (typeof handler !== 'function') return;
    if (!cardHandlers.has(name)) cardHandlers.set(name, new Set());
    cardHandlers.get(name).add(handler);
  };
  window.eventRemoveListener = function (name, handler) {
    if (cardHandlers.has(name)) cardHandlers.get(name).delete(handler);
  };
  window.eventEmit = function (name) {
    var args = Array.prototype.slice.call(arguments, 1);
    if (!cardHandlers.has(name)) return;
    cardHandlers.get(name).forEach(function (h) {
      try { h.apply(null, args); } catch (e) { console.error('[js-slash-runner] 卡片事件处理器抛错 ' + name, e); }
    });
  };
  // 宿主（FrontendCard 渲染器）在变量变化时调用它 —— 派发 VariableUpdateEnded 触发重绘。
  window.__nyaCardDispatch = function () {
    window.eventEmit.apply(null, arguments);
  };
  // Mvu 由脚本宿主镜像到父窗口（见 buildPredefineScript 的 __nyaSyncMvu）；这里以 getter 取，
  // 保证卡片拿到的是同一个对象（Mvu.events.* 的事件名必须一致）。
  try {
    Object.defineProperty(window, 'Mvu', {
      configurable: true,
      get: function () { try { return window.parent.Mvu; } catch (e) { return undefined; } },
      set: function () { /* 空 set：与脚本宿主侧一致 */ },
    });
  } catch (e) { /* 定义失败也不能影响卡片渲染 */ }

  // ── 依赖桥的部分：动态 getter（每次调用现取 api，桥重挂载后自动跟上）─────────
  // ⚠️ 形状必须与 ST 的 getAllVariables 一致：**顶层就是合并后的变量表**（卡片直接
  //    取 vars.stat_data），而不是 {global,chat,message} 的嵌套壳。嵌套壳会让
  //    vars.stat_data === undefined，状态栏每个字段都落到卡片里的字面兜底值
  //    （真机 v12-2109 实测：JSONPatch 已把世界.当前时间改成 07:05，面板仍显示 07:00）。
  window.getAllVariables = function () {
    var api = getApi();
    if (!api) return {};
    return api.variables.getVariables('message', { messageId: 'latest' }) || {};
  };
  window.getVariables = function (option) {
    var api = getApi();
    if (!api) return {};
    option = option || {};
    var scope = option.type === 'chat' ? 'chat' : option.type === 'global' ? 'global' : 'message';
    return api.variables.getVariables(scope, scope === 'message' ? { messageId: option.message_id || 'latest' } : undefined);
  };
  window.getLastMessageId = function () { var api = getApi(); return api ? api.messages.getLastId() : -1; };
  window.getLastMessage = function () {
    var api = getApi();
    if (!api) return null;
    var all = api.messages.getAll();
    return all.length ? all[all.length - 1] : null;
  };
  window.getChatMessages = function (range) {
    var api = getApi();
    if (!api) return [];
    var all = api.messages.getAll();
    var last = api.messages.getLastId();
    var idx = [];
    if (range === undefined || range === null || range === 'latest') idx = [last];
    else if (typeof range === 'number') idx = [range < 0 ? last + 1 + range : range];
    else if (Array.isArray(range)) idx = range.map(function (r) { return typeof r === 'number' && r < 0 ? last + 1 + r : r; });
    else if (typeof range === 'object') {
      var s = range.start !== undefined ? range.start : 0;
      var e = range.end !== undefined ? range.end : last;
      if (s < 0) s = last + 1 + s;
      if (e < 0) e = last + 1 + e;
      for (var i = s; i <= e; i++) idx.push(i);
    }
    return idx
      .filter(function (i) { return i >= 0 && i < all.length; })
      .map(function (i) {
        var m = all[i];
        var data = (m.variables && m.variables[0]) || {};
        return {
          message_id: i, role: m.role, name: m.name,
          message: m.content, data: data,
          swipes_data: [data], swipes_id: [0], swipe_id: 0,
        };
      });
  };
  // 身份：用 getter 读**活值**（桥晚到时也能拿到；不是一次性快照）。
  window.getCurrentPersonaName = function () { var api = getApi(); return api ? api.identity.user : ''; };
  window.getCurrentCharName = function () { var api = getApi(); return api ? api.identity.char : ''; };
  try {
    Object.defineProperty(window, 'SillyTavern', {
      configurable: true,
      get: function () {
        var api = getApi();
        return { name1: api ? api.identity.user : '', name2: api ? api.identity.char : '' };
      },
      set: function () { /* 空 set */ },
    });
  } catch (e) { /* 定义失败也不能影响卡片渲染 */ }

  // 全局初始化握手（M7 语义）：已存在则立即 resolve，否则轮询等上游写 window.Mvu。
  window.waitGlobalInitialized = function (name, timeoutMs) {
    var limit = typeof timeoutMs === 'number' ? timeoutMs : 20000;
    return new Promise(function (resolve) {
      var started = Date.now();
      function check() {
        try {
          if (name !== 'Mvu' || (typeof window.Mvu !== 'undefined' && window.Mvu)) { resolve(); return; }
        } catch (e) { /* getter 抛错按未就绪处理 */ }
        if (Date.now() - started > limit) { resolve(); return; }
        setTimeout(check, 50);
      }
      check();
    });
  };

  // ── 桥就绪握手：动态轮询；桥出现后补装一次并广播 __nyaCardReady ─────────────
  // 卡片常用 waitGlobalInitialized('Mvu') 或首次 render() 取数；桥晚于卡片脚本时，
  // 让它们有一个"可以重画"的信号（不强制，缺失也不报错）。
  var readyDone = false;
  function installWhenReady() {
    if (readyDone) return;
    if (!getApi()) return;
    readyDone = true;
    try { window.dispatchEvent(new Event('__nyaCardReady')); } catch (e) {}
  }
  installWhenReady();
  if (!readyDone) {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      installWhenReady();
      if (readyDone || tries > 400) clearInterval(timer);   // 最多 ~20s
    }, 50);
  }
})();
`;
}
