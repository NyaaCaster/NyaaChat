/**
 * 变量路径解析与读写（SSOT §2.2 的 `paths.ts`）。
 *
 * 支持两种分隔符（`/` 与 `.`）、数组下标（`[0]`）与追加（`[-]`），对齐酒馆助手
 * 文档里 `/stat_data/世界/当前日期` 与前端代码里常见的 `a.b[0].c` 两种写法。
 *
 * 语义要点：
 *  · 段是**容器相关**的：同一个 `"0"` 段在数组上按数字下标、在对象上按字符串键
 *    （所以不能简单地把数字段全转成 number）；
 *  · `getByPath` / `deleteByPath` 对不存在的路径返回 `undefined` / `false`，
 *    不抛错；`setByPath` 对**非法路径**（空段、在标量上继续下钻、追加段用在
 *    非数组上）抛错 —— 调用方（变量 API）需要把它变成脚本可见的错误。
 */
import type { PathSegment } from "./types";

/** 解析路径。空串 / `"/"` → `[]`（表示整个对象）。 */
export function parsePath(path: string): PathSegment[] {
  if (typeof path !== "string") {
    throw new TypeError(`[variables] path must be a string, got ${typeof path}`);
  }
  const trimmed = path.trim();
  if (trimmed === "" || trimmed === "/" || trimmed === ".") return [];

  const normalized = trimmed
    .replace(/\[\s*(\d+)\s*\]/g, ".$1")
    .replace(/\[\s*-\s*\]/g, ".-");
  const body = normalized.startsWith("/") || normalized.startsWith(".")
    ? normalized.slice(1)
    : normalized;

  const raws = body.split(/[/.]/).filter((p) => p.length > 0);
  return raws.map((raw) => ({
    raw,
    index: /^-?\d+$/.test(raw) ? Number(raw) : null,
    append: raw === "-",
  }));
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 按路径取值；路径不存在返回 `undefined`。 */
export function getByPath(root: unknown, segments: readonly PathSegment[]): unknown {
  let cur: unknown = root;
  for (const seg of segments) {
    if (Array.isArray(cur)) {
      if (seg.append) return undefined;
      const idx = seg.index;
      if (idx === null) return undefined;
      cur = cur[idx < 0 ? cur.length + idx : idx];
    } else if (isPlainObject(cur)) {
      if (seg.append) return undefined;
      cur = cur[seg.raw];
    } else {
      return undefined;
    }
    if (cur === undefined) return undefined;
  }
  return cur;
}

/** 容器选择：给定下一个段，决定要创建数组还是对象。 */
function containerFor(next: PathSegment | undefined): unknown {
  if (!next) return {};
  return next.index !== null || next.append ? [] : {};
}

/**
 * 按路径写入（**原地修改** `root`；调用方必须先持有深拷贝）。
 * 非法路径（在标量上下钻、追加段落在非数组上）抛错。
 */
export function setByPath(
  root: Record<string, unknown> | unknown[],
  segments: readonly PathSegment[],
  value: unknown,
): void {
  if (segments.length === 0) {
    throw new Error("[variables] setByPath: empty path (cannot replace the whole scope here)");
  }

  let cur: unknown = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const next = segments[i + 1];

    if (Array.isArray(cur)) {
      if (seg.append) throw new Error(`[variables] setByPath: "-" is only valid as the last segment`);
      const idx = seg.index;
      if (idx === null) {
        throw new Error(`[variables] setByPath: "${seg.raw}" is not a valid array index`);
      }
      const real = idx < 0 ? cur.length + idx : idx;
      if (real < 0) {
        throw new Error(`[variables] setByPath: array index ${idx} out of range`);
      }
      if (cur[real] === undefined) {
        // 中间层缺失：只允许**紧接末尾**增长（`a.b[0].c` 这种"新建数组后立刻
        // 下钻"就落在这里）。拒绝隔空跳号 —— 那会造出空洞，JSON 序列化成 null，
        // 属于静默的数据形状污染，宁可显式报错。
        if (real > cur.length) {
          throw new Error(
            `[variables] setByPath: array index ${idx} skips past the end (length ${cur.length})`,
          );
        }
        cur[real] = containerFor(next);
      } else if (cur[real] === null || typeof cur[real] !== "object") {
        throw new Error(
          `[variables] setByPath: cannot descend into scalar at "${seg.raw}"`,
        );
      }
      cur = cur[real];
    } else if (isPlainObject(cur)) {
      if (seg.append) throw new Error(`[variables] setByPath: "-" is not a valid object key`);
      const key = seg.raw;
      const existing = cur[key];
      if (existing === undefined) {
        cur[key] = containerFor(next);
      } else if (existing === null || typeof existing !== "object") {
        throw new Error(`[variables] setByPath: cannot descend into scalar at "${key}"`);
      }
      cur = cur[key];
    } else {
      throw new Error(`[variables] setByPath: cannot descend through a scalar at "${seg.raw}"`);
    }
  }

  const last = segments[segments.length - 1];
  if (Array.isArray(cur)) {
    if (last.append) {
      cur.push(value);
      return;
    }
    const idx = last.index;
    if (idx === null) {
      throw new Error(`[variables] setByPath: "${last.raw}" is not a valid array index`);
    }
    if (idx === -1) {
      // `-1` on an array = append-as-last (lodash `_.set` treats it as a key,
      // but scripts write `-1`/`-` expecting "the end"; append is the useful one).
      cur.push(value);
      return;
    }
    const real = idx < 0 ? cur.length + idx : idx;
    if (real < 0) throw new Error(`[variables] setByPath: array index ${idx} out of range`);
    cur[real] = value;
    return;
  }
  if (isPlainObject(cur)) {
    if (last.append) throw new Error(`[variables] setByPath: "-" is not a valid object key`);
    cur[last.raw] = value;
    return;
  }
  throw new Error(`[variables] setByPath: cannot write through a scalar at "${last.raw}"`);
}

/** 按路径删除；删到了返回 `true`。 */
export function deleteByPath(
  root: Record<string, unknown> | unknown[],
  segments: readonly PathSegment[],
): boolean {
  if (segments.length === 0) return false;

  let cur: unknown = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (Array.isArray(cur)) {
      const idx = seg.index;
      if (idx === null) return false;
      cur = cur[idx < 0 ? cur.length + idx : idx];
    } else if (isPlainObject(cur)) {
      cur = cur[seg.raw];
    } else {
      return false;
    }
    if (cur === undefined || cur === null || typeof cur !== "object") return false;
  }

  const last = segments[segments.length - 1];
  if (Array.isArray(cur)) {
    const idx = last.index;
    if (idx === null) return false;
    const real = idx < 0 ? cur.length + idx : idx;
    if (real < 0 || real >= cur.length) return false;
    cur.splice(real, 1);
    return true;
  }
  if (isPlainObject(cur)) {
    if (!(last.raw in cur)) return false;
    delete cur[last.raw];
    return true;
  }
  return false;
}
