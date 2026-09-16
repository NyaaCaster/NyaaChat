/**
 * 宿主适配器注册点（SSOT §2.2 的 `adapter.ts`）。
 *
 * 变量层**不做持久化**：message/chat 的写入经 `VariableAdapter.commitSession`
 * 交回宿主（宿主 setState → 既有自动保存链路），global 由 `scopes.ts` 自己落
 * IndexedDB。这样变量层可以在没有 React 的环境（单测、验证脚本）里被驱动。
 *
 * 由 `src/App.tsx` 的一个 effect 注册；StrictMode 下 effect 会跑两次，
 * 因此这里是**幂等覆盖**，且卸载时置 null（下一次挂载会重新注册）。
 */
import type { VariableAdapter } from "./types";

let adapter: VariableAdapter | null = null;

export function setVariableAdapter(next: VariableAdapter | null): void {
  adapter = next;
}

export function getVariableAdapter(): VariableAdapter | null {
  return adapter;
}
