# 详细设计：记忆分界 UI 与消息模型

> 覆盖空洞 E。归属仓库：`NyaaChat` 主仓
> 关联不变量：SSOT §11 第 11 条「提炼后 UI 气泡保留 + 可见记忆分界标记」

---

## 1. 问题定义

提炼后，被提炼的轮次**从发送 history 移除，但 UI 气泡保留**。于是需要回答四件事：

1. "哪些消息已被移出 history" 这个信息存在哪里
2. `buildRequestMessages` 收到的 `baseMessages` 如何据此裁剪
3. 多批次提炼产生多条分界线时怎么渲染
4. 导出 / 导入 / 云同步 / 删除消息 时这个信息如何存续

---

## 2. 数据模型：标记在"批次最后一条消息"上

### 2.1 选型结论

在 `Message` 上新增一个可选字段，标记**该批次的最后一条被提炼消息**：

```ts
// src/types.ts — Message interface 内，紧跟 tokenCount 之后
  /** Set on the LAST message of an extracted memory batch. Messages at or
   *  before this position have been distilled into the server-side memory KB
   *  and are excluded from the history sent to the model; the bubble itself is
   *  kept so the user still sees the conversation. The value is the batch
   *  sequence number used as `documents.name = <sessionId>#<batchSeq>`, so a
   *  bubble can be traced back to the memory document it produced. */
  memoryBatchSeq?: number;
```

### 2.2 为什么不用其他三种方案

| 备选 | 否决理由 |
|---|---|
| `ChatSession.metadata` 里存一个下标 | 下标会被"删除中间某条消息"打乱，且 `metadata` 是 ST 兼容字段（`types.ts:343`），塞私有语义会与 `chat_metadata` 兼容层打架 |
| 插一条 `role: "system"` 的分界消息 | `MessageItem:262` 会把它渲染成 System 胶囊并截断到 50 字；`macros.ts:134` 的 `{{lastUserMessage}}` 依赖 `isSystem` 语义；`runtimeStore.ts:132` 会把它同步给 ST 扩展。副作用面太大 |
| 在每条被提炼消息上都打标 | 冗余，且"边界在哪"要遍历求最大下标，等价于只标最后一条 |

标记在最后一条上，天然满足：批次数 = 标记数 = 分界线数；顺序由数组顺序保证；不需要额外的下标同步。

---

## 3. 发送侧裁剪

### 3.1 裁剪函数

新增 `src/lib/memoryBoundary.ts`：

```ts
import type { Message } from "../types";

/**
 * Index of the last extracted-batch boundary, or -1 when the session has none.
 * Scans backwards: the newest marker is the effective boundary, so multiple
 * batches collapse to a single cut point without needing them to be ordered.
 */
export function findBoundaryIndex(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].memoryBatchSeq !== undefined) return i;
  }
  return -1;
}

/** Messages that should actually be sent as history. */
export function messagesAfterBoundary(messages: Message[]): Message[] {
  const idx = findBoundaryIndex(messages);
  return idx < 0 ? messages : messages.slice(idx + 1);
}

/** All batch sequence numbers present in this session, ascending. */
export function extractedBatchSeqs(messages: Message[]): number[] {
  return messages
    .map((m) => m.memoryBatchSeq)
    .filter((s): s is number => s !== undefined)
    .sort((a, b) => a - b);
}

/** Next batch sequence number for this session (1-based). */
export function nextBatchSeq(messages: Message[]): number {
  const seqs = extractedBatchSeqs(messages);
  return seqs.length === 0 ? 1 : seqs[seqs.length - 1] + 1;
}
```

### 3.2 接入点

`ChatInterface.tsx` 里 `baseMessages` 共 5 处传入（`:1157`、`:1201`、`:1264`、`:1292`、`:1309`），
全部是 `messagesRef.current`。**不在这 5 处逐个改**，改在唯一的消费点：

`chatPipeline.ts:364` 的 `filteredHistory`：

```ts
  const filteredHistory = messagesAfterBoundary(baseMessages).filter(
    (m) => m.role !== "system" && !m.imageUrl && !m.imagePrompt,
  );
```

**顺序必须是先切边界、再过滤**：反过来的话下标语义已变，但 `messagesAfterBoundary`
是按标记而非下标定位，两种顺序结果相同 —— 仍统一写成先切，避免读者以为下标相关。

这样裁剪对所有调用路径（正常发送、重新生成、编辑后重发、注入轮次）自动生效，
不存在"某条路径忘了裁剪"的漏洞。

### 3.3 depth 语义的连带影响

`filteredHistory.length - i` 计算的 regex `depth`（`chatPipeline.ts:370`）在裁剪后变小。
这是**正确的**：depth 的语义是"距最新一轮多远"，被提炼的轮次已不在请求里，
不应再占 depth 位。深度门控的 regex 脚本行为随之变化，属预期。

---

## 4. UI 渲染

### 4.1 分界组件

新增 `src/components/MemoryDivider.tsx`：

```tsx
import React from "react";
import { motion } from "framer-motion";
import { Archive } from "lucide-react";

interface MemoryDividerProps {
  /** Batch sequence number, shown so multiple batches are distinguishable. */
  seq: number;
}

/**
 * Horizontal rule marking where a memory batch was extracted. Everything above
 * the newest divider is no longer sent to the model — it lives only in the
 * server-side memory KB and comes back through retrieval. The bubbles above
 * stay visible on purpose: without them the user would scroll into a void.
 */
export default function MemoryDivider({ seq }: MemoryDividerProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex items-center gap-3 my-6 select-none"
      title="以上内容已归档为持久记忆，不再随每轮发送给模型，会在需要时被检索召回"
    >
      <div className="h-px flex-1 bg-gradient-to-r from-transparent to-amber-300/50 dark:to-amber-400/25" />
      <span className="flex items-center gap-1.5 text-[11px] text-amber-600/80 dark:text-amber-400/70 whitespace-nowrap">
        <Archive size={12} />
        记忆分界 #{seq}
      </span>
      <div className="h-px flex-1 bg-gradient-to-l from-transparent to-amber-300/50 dark:to-amber-400/25" />
    </motion.div>
  );
}
```

样式取琥珀色，与 NyaaChat 既有"额度 / 扩容"类提示色系一致（见 P18 划转 UI 定调），
区别于错误红与主色。

### 4.2 插入渲染树

`ChatInterface.tsx:1444` 的 `messages.map` 改为 `flatMap`，分界线作为**兄弟节点**
而非包在 Fragment 里 —— `AnimatePresence` 需要直接看到带 key 的子节点，
Fragment 会让它丢失退场动画追踪：

```tsx
{messages.flatMap((message, idx) => {
  const nodes: React.ReactNode[] = [
    <MessageItem
      key={message.id}
      message={message}
      mesid={idx}
      /* …其余 props 原样不动… */
    />,
  ];
  if (message.memoryBatchSeq !== undefined) {
    nodes.push(
      <MemoryDivider key={`mb-${message.id}`} seq={message.memoryBatchSeq} />,
    );
  }
  return nodes;
})}
```

**分界线在被标记气泡之后**（视觉上"线以上已归档"）。`mesid={idx}` 仍用原数组下标，
不受分界影响 —— ST 扩展按楼层引用消息，楼层号不能因为归档而跳号。

### 4.3 多批次

第二批提炼标记更靠后的一条消息，于是页面上出现两条线：`#1`、`#2`。
发送裁剪只认最后一条（`findBoundaryIndex` 反向扫描），
但历史分界线全部保留 —— 它们记录了归档的时间轴，删掉反而让用户困惑。

---

## 5. 生命周期联动

### 5.1 删除消息

`handleDeleteMessage` 需增加标记转移。被删的消息若持有 `memoryBatchSeq`，
标记**下移到前一条消息**；若它已是第 0 条，标记随之消失。

```ts
// In handleDeleteMessage, before/while filtering out the target message.
function transferBoundaryOnDelete(messages: Message[], deletedId: string): Message[] {
  const idx = messages.findIndex((m) => m.id === deletedId);
  if (idx < 0) return messages;
  const seq = messages[idx].memoryBatchSeq;
  const next = messages.filter((m) => m.id !== deletedId);
  // No marker on the removed message, or nothing left above it → nothing to move.
  if (seq === undefined || idx === 0) return next;
  const target = next[idx - 1];
  next[idx - 1] = { ...target, memoryBatchSeq: target.memoryBatchSeq ?? seq };
  return next;
}
```

`?? seq` 而非直接覆盖：前一条可能已持有更早批次的标记，
覆盖会丢掉那一批的分界线。保留更早的即可 —— 裁剪只看最后一条标记的位置，
两个标记落在同一条消息上没有额外语义。

**服务端记忆不因删除消息而变动**。这是有意的：那批事实已经提炼完成、
用户已经付过 token，删一个气泡不该销毁它。

### 5.2 编辑消息

分界线以上的气泡仍可编辑（`onEdit` 不做限制）。编辑**不重新提炼**、
不修改服务端记忆条目 —— 记忆是当时的快照。
不加拦截也不加提示：加了反而暗示"编辑会同步记忆"这个不存在的行为。

### 5.3 重新生成 / 注入轮次

`handleRegenerate` 操作最新的 assistant 消息，永远在分界线以下，无需特殊处理。
`:789` 的注入轮次走同一条 `baseMessages` 交接，裁剪已在 `chatPipeline` 生效。

### 5.4 清空 / 删除对话

删除 session 时按 SSOT 调 `DELETE /memory/session/:sessionId`
（见 `设计-记忆生命周期与配额.md` §2），消息与标记随 session 一起消失。

---

## 6. 导出 / 导入 / 云同步

| 通道 | 行为 | 是否需要改代码 |
|---|---|---|
| JSON 导出（`ChatHistoryModal.tsx:99` `JSON.stringify(session, null, 2)`） | `memoryBatchSeq` 自动随消息序列化 | 否 |
| JSON 导入 | 旧档无该字段 → `undefined` → 无分界，行为等同未提炼 | 否 |
| Markdown 导出（`exportSession.ts:8`） | 需补一行可见分界，否则导出稿看不出上下文断点 | **是**，见下 |
| 云同步（`chatCrypto.ts:126` 整体加密 `ChatSession[]`） | 字段随载荷加密上传/下载 | 否 |
| `replaceAllSessions` 覆盖式下载 | 标记随之覆盖，与 session 一致 | 否 |

`exportSession.ts` 的循环内，输出消息之后追加：

```ts
    if (m.memoryBatchSeq !== undefined) {
      lines.push(`> ── 记忆分界 #${m.memoryBatchSeq} ──`);
      lines.push("");
    }
```

### 6.1 跨设备一致性说明

服务端记忆按 `owner + session_id` 存储，而 `session.id` 随云同步一起传递，
所以在另一台设备下载记录后，分界线与服务端记忆仍然对应，检索照常工作。
**前提是记忆开关在该设备也开启** —— 否则只看到分界线、检索不发生，
用户会感到"上文丢了"。因此关闭开关时需要处理已有分界，见
`设计-账号界面与设置存档.md` 的空洞 Q 定案。

---

## 7. 验收清单

1. 首次提炼后，被提炼批次末条消息下方出现「记忆分界 #1」，上方气泡全部保留
2. 下一轮请求的 `messages` 数组中，分界线以上的轮次全部不存在（用日志面板核对）
3. 第二次提炼后出现「#2」，`#1` 仍在，发送裁剪按 `#2` 位置执行
4. 删除持有标记的气泡 → 分界线上移一条，裁剪位置随之上移一条
5. 删除第 0 条且它持有标记 → 分界线消失，全部消息回到 history
6. 分界线以上的气泡可正常编辑、复制、删除
7. `mesid` 楼层号连续，不因分界跳号（ST 扩展 `data-mesid` 核对）
8. JSON 导出后重新导入 → 分界线位置一致
9. Markdown 导出含 `> ── 记忆分界 #N ──`
10. 云上传 → 另一浏览器下载 → 分界线位置一致
11. 旧版本导出的 JSON（无 `memoryBatchSeq`）导入不报错、无分界
