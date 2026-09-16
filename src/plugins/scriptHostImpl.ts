/**
 * 脚本宿主门面的**宿主侧实现**（SSOT §2.3 / §2.2）。
 *
 * ⚠️ 插件禁止 import 本文件（它 import `src/lib/variables`，会构成通往注册表之外的
 * 宿主核心依赖）。`src/App.tsx` 启动时构造一次并 `setScriptHostApi()`。
 *
 * 变量部分全部委托给变量层（`src/lib/variables`），因此**读写语义、深拷贝读契约、
 * messageId 语义、守门行为**都只有一份实现；本文件只做「把门面形状翻译成变量层调用」
 * 与「会话/角色/世界书的读取」。
 */
import type { CharacterSettings, Message } from "../types";
import {
  deleteVariable,
  getVariableAdapter,
  getVariableAtPath,
  getVariables,
  hasVariable,
  insertVariables,
  replaceVariables,
  substituteVariableMacros,
  updateVariablesWith,
} from "../lib/variables";
import type {
  ScriptHostApi,
  ScriptHostCharacterApi,
  ScriptHostChatMessage,
  ScriptHostLorebookEntry,
  ScriptHostMessagesApi,
} from "./scriptHost";

function liveSession() {
  const adapter = getVariableAdapter();
  if (!adapter) return null;
  const id = adapter.getCurrentSessionId();
  if (!id) return null;
  return adapter.getSession(id);
}

const messagesApi: ScriptHostMessagesApi = {
  // ⚠️ 「就绪」= 会话已解析**且至少有一层**，不是"适配器已注册"。
  // 插件在应用启动期就挂载，那一刻 `currentSessionId` 往往还是 null ⇒ `getAll()` 返回 []
  // ⇒ MVU 的 initvar 读到空聊天，打印 runtime.initvar.noMessagesLog 后**直接退出且不再重试**
  // （真机 v10-1600 症状：变量永不初始化、每轮回复没有状态栏）。
  chatReady: () => {
    const session = liveSession();
    return !!session && session.messages.length > 0;
  },
  diagnostics: () => {
    const adapter = getVariableAdapter();
    const session = liveSession();
    return {
      adapterReady: adapter !== null,
      sessionId: adapter?.getCurrentSessionId() ?? null,
      sessionFound: session !== null,
      liveMessages: session?.messages.length ?? -1,
    };
  },
  getAll: () => liveSession()?.messages ?? [],
  getLastId: () => {
    const messages = liveSession()?.messages;
    return messages && messages.length > 0 ? messages.length - 1 : -1;
  },
  update: (updater) => {
    const adapter = getVariableAdapter();
    const session = liveSession();
    if (!adapter || !session) {
      console.warn("[scriptHost] messages.update 被调用时没有打开的会话，已忽略");
      return;
    }
    const next = updater(session.messages);
    if (!Array.isArray(next)) return;
    // 临时诊断：脚本侧改写消息是否真的产生新对象（`__nyaScriptRunnerDiag().varTrace`）。
    try {
      const w = window as unknown as { __nyaVarTrace?: unknown[] };
      const changed = next.length === session.messages.length && next.some((m, i) => m !== session.messages[i]);
      w.__nyaVarTrace = (w.__nyaVarTrace || [])
        .concat([
          {
            t: Date.now(),
            k: "msgsUpdate",
            before: session.messages.length,
            after: next.length,
            changed,
            vars0: Array.isArray((next[0] as { variables?: unknown } | undefined)?.variables),
          },
        ])
        .slice(-60);
    } catch {
      /* 诊断失败不影响主流程 */
    }
    // ⚠️ 只把**这次真的变了**的字段作为意图补丁交回宿主：`next` 是从（可能过期的）
    //    `session.messages` 拷贝出来的，未变的字段带着旧值 —— 若整条消息当权威交回去，
    //    宿主按 id 合并时会用旧值回滚同一 tick 里刚落地的其它写入（v12-1625 真机实证：
    //    MVU 的楼层变量被紧随其后的 chat 作用域写入抹掉）。
    const patches: Array<{ id: string; content?: string; variables?: unknown }> = [];
    for (let i = 0; i < next.length; i++) {
      const before = session.messages[i];
      const after = next[i];
      if (!after || after === before) continue;
      const patch: { id: string; content?: string; variables?: unknown } = { id: after.id };
      let dirty = false;
      if (after.content !== before?.content) {
        patch.content = after.content;
        dirty = true;
      }
      if (after.variables !== before?.variables) {
        patch.variables = after.variables;
        dirty = true;
      }
      if (dirty) patches.push(patch);
    }
    if (patches.length && typeof adapter.patchMessages === "function") {
      adapter.patchMessages(patches);
      return;
    }
    adapter.commitSession({ ...session, messages: next });
  },
};

/** JSR `getChatMessages()` 的单条映射（M4：`data` 与 `variables[swipe_id]` 同对象）。 */
function toChatMessage(message: Message, index: number, charName: string, userName: string): ScriptHostChatMessage {
  const swipes = Array.isArray(message.variables) ? message.variables : [];
  const data = swipes[0] ?? {};
  return {
    message_id: index,
    role: message.role,
    name: message.role === "user" ? userName : charName,
    message: message.content,
    data,
    swipes_data: swipes.length > 0 ? swipes : [{}],
    swipes_id: swipes.map((_, i) => i),
    swipe_id: 0,
  };
}

export { toChatMessage };

function lorebookApi(character: ScriptHostCharacterApi) {
  return {
    getSettings: () => ({
      // MVU 会展开这个数组（源码：`[...(await getLorebookSettings()).selected_global_lorebooks]`）
      // ⇒ 缺键就 TypeError: not iterable，进而打断它的变量初始化（真机实测）。
      selected_global_lorebooks: [] as string[],
      world_info: { global: null },
      // MVU 用它做 _.merge 比较，并在不同时调用 setLorebookSettings 回写；
      // 这里给出与它默认值一致的形状，避免无谓的回写（回写本身已被接受并忽略）。
      context_percentage: 100,
      budget_cap: 0,
      min_activations: 0,
      max_depth: 0,
      max_recursion_steps: 0,
      insertion_strategy: "character_first",
      include_names: false,
      recursive: true,
      case_sensitive: false,
      match_whole_words: false,
      use_group_scoring: false,
      overflow_alert: false,
    }),
    getCharLorebooks: () => {
      const name = character.getName();
      return { primary: name || null, additional: [] as string[] };
    },
    getEntries: (): ScriptHostLorebookEntry[] =>
      character.getWorldInfo().map((rule) => ({
        id: rule.id,
        comment: rule.name,
        content: rule.content,
        enabled: rule.enabled,
        constant: rule.triggerType === "permanent",
        keys: rule.keywords ?? "",
        position: rule.position,
      })),
  };
}

/**
 * 构造门面。`character` 由 `App.tsx` 提供（它持有 AppState）；其余部分在这里派生。
 * `identity` 读叶子 `hostContext` —— 直接传值进来也可以，但那样 App 要重复维护同一口径。
 */
export function createScriptHostApi(args: {
  character: ScriptHostCharacterApi;
  identity: { user: string; char: string };
}): ScriptHostApi {
  const { character, identity } = args;

  return {
    identity,
    character,
    variables: {
      getVariables: (scope, option) => getVariables(scope, option),
      replaceVariables: (next, scope, option) => replaceVariables(next, scope, option),
      updateVariablesWith: (updater, scope, option) => updateVariablesWith(updater, scope, option),
      insertVariables: (vars, scope, option) => insertVariables(vars, scope, option),
      deleteVariable: (path, scope, option) => deleteVariable(path, scope, option),
      hasVariable: (path, scope, option) => hasVariable(path, scope, option),
      getVariableAtPath: (path, scope, option) => getVariableAtPath(path, scope, option),
    },
    messages: messagesApi,
    lorebook: lorebookApi(character),
    macros: {
      substitute: (text: string) =>
        substituteVariableMacros(
          String(text ?? "")
            .replace(/\{\{user\}\}/g, identity.user)
            .replace(/\{\{char\}\}/g, identity.char),
        ),
    },
    vendor: {
      manifestUrl: "/vendor/script-host/manifest.json",
      // t1 实测：lodash/jquery/toastr 是 classic 全局；yaml/zod 官方**无 UMD 产物**，
      // 故直接 import 被包装的官方 ESM 产物（`.esm.js`），由 bootstrap 把命名空间挂到
      // window（等价于原 `.mjs` 包装的副作用）。
      // ⚠️ **刻意不用 `/vendor/script-host/{yaml.min.js,zod.mjs}` 这两个生成的包装**：
      //    `.mjs` 会被 nginx 以 `application/octet-stream` + `nosniff` 下发（容器
      //    mime.types 无 mjs），Chrome 直接拒绝当模块加载 ⇒ 整条脚本链中止、MVU 从不
      //    加载（t7 真机实测的 F1 blocker，dev/prod 同基底）。`.esm.js` 的 MIME 正确。
      // 顺序固定（toastr 依赖 window.jQuery）。
      globals: [
        { path: "/vendor/script-host/lodash.min.js", esm: false },
        { path: "/vendor/script-host/jquery.min.js", esm: false },
        { path: "/vendor/script-host/toastr.min.js", esm: false },
        // ⚠️ **Vue 是 MVU 的硬依赖，不是可选增强**：`mvu/bundle.js` 的 webpack
        // externals 明写 `Vue`/`YAML`/`z`（`4061(e){e.exports=Vue}` 等，vendor 实测），
        // 并用 `createApp(...).use(pinia)`（pinia 已内置进 bundle，不需自托管）。
        // 缺 `window.Vue` 会在**模块求值阶段**抛 `ReferenceError: Vue is not defined`
        // ⇒ 整链失败。它必须是 **classic 全局**（`esm:false`）且在 bundle 被 import
        // 之前就绪；扩展名必须是 `.js`（`.mjs` 会被 nginx 以 octet-stream + nosniff 拒掉，F1）。
        { path: "/vendor/script-host/vue.global.js", esm: false },
        { path: "/vendor/script-host/yaml/yaml.esm.js", esm: true, globalName: "YAML" },
        { path: "/vendor/script-host/zod/zod.esm.js", esm: true, globalName: "z" },
      ],
    },
  };
}

/** 供 `App.tsx` 少写样板：把 AppState 里的当前角色包成 `ScriptHostCharacterApi`。 */
export function characterApiFrom(args: {
  getCharacter: () => CharacterSettings | null | undefined;
  setScripts: (next: CharacterSettings["scripts"]) => void;
}): ScriptHostCharacterApi {
  return {
    getId: () => args.getCharacter()?.id ?? null,
    getName: () => args.getCharacter()?.name ?? "",
    getScripts: () => args.getCharacter()?.scripts ?? [],
    setScripts: (next) => args.setScripts(next),
    getWorldInfo: () => args.getCharacter()?.worldInfo ?? [],
  };
}
