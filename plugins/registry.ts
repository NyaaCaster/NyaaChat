/**
 * NyaaChat 插件注册表 —— **全仓唯一的插件注册入口**（SSOT §2.1 / §2.3）。
 *
 * 构建模型：Vite 从 `index.html → src/main.tsx` 全量打包，`plugins/**` 只能
 * 通过本文件进入依赖图 ⇒ 没有运行时加载器、没有动态 `import()`、没有白名单
 * 机制。因此**插件集合的唯一权威就是这份代码**：开发者在这里增删一项，用户
 * 界面的插件列表随之增减，无需任何用户侧操作或迁移代码。
 *
 * 排序：`meta.order` 升序（缺省视为 0），相同则按 `meta.name` 字典序。
 * 校验：`src/plugins/registry.ts` 在模块加载时对本数组做一次结构校验
 * （id 唯一且 kebab-case / name·version 非空 / capability 唯一 / path 前缀），
 * 失败只 `console.error`，不抛异常（生产不白屏）。
 *
 * 类型来自宿主侧契约 `src/plugins/types.ts`（type-only 导入，不产生运行时环）。
 */
import type { NyaaPlugin } from "../src/plugins/types";
import quoteTts from "./quote-tts/plugin";

/** 已注册插件。首个（也是当前唯一）原生插件是 `quote-tts`（P5 落地）。
 *
 *  ⚠️ 不要为了让 UI 显示出东西而在这里塞占位插件：列表只由本数组产生，
 *  塞进来的东西就是"真实存在的插件"。
 */
const registered: NyaaPlugin[] = [quoteTts];

export const plugins: NyaaPlugin[] = registered.sort((a, b) => {
  const ao = typeof a.meta.order === "number" ? a.meta.order : 0;
  const bo = typeof b.meta.order === "number" ? b.meta.order : 0;
  if (ao !== bo) return ao - bo;
  return a.meta.name.localeCompare(b.meta.name);
});
