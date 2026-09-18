/**
 * EJS 模板插件 · **lodash 子集**（零依赖内联实现，SSOT D10 / 技术性说明 §4.2）
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 为什么要有这个文件
 * ────────────────────────────────────────────────────────────────────────────
 * 依赖 EJS 的角色卡里，模板代码实际用到的 lodash 只有 **9 个函数**
 * （实测：`get` 212 / `random` 38 / `has` 3 / `omit` 1 / `cloneDeep` 1 /
 *  `isObject` 1 / `set` 1 / `sample` 1 / `sampleSize` 1，共 259 处）：
 *
 *   `const cleanData = _.omit(_.cloneDeep(data), '事件');`
 *   `const finalBossStrength = 45 + (defeatedCount * 6) + _.random(-5, 10);`
 *   `_.has(getvar('stat_data'), '系统状态.主角创建完毕')`
 *
 * 只为了这 9 个函数去 import 整包 lodash（约 70 KB min）不划算，所以这里
 * **按需内联**，语义逐条对齐 lodash 4.18.1（本仓 `node_modules/lodash`）。
 * 移植纪律见《ST扩展移植规范》§10.8：**按需补，不预置整库**；后续若扩样
 * 发现新函数，照此文件追加即可。
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 随机源注入（D15）—— **本文件唯一容易被误用的地方**
 * ────────────────────────────────────────────────────────────────────────────
 * `_.random` ×38、`_.sample` ×1、`_.sampleSize` ×1 让 EJS 输出**天然不确定**
 * （如"BOSS 强度 = 45 + 已击败数×6 + `_.random(-5,10)`"）。黄金基准与 P1
 * 逐字节验收因此必须**注入可控随机源**，否则"同输入两次渲染逐字节相同"
 * 这类断言根本不成立。
 *
 * 注入契约（P0/P1 基准脚本与本文件必须**逐字对齐**）：
 *
 *   `setRandomSource(fn)` 的 `fn` 是 **裸 [0,1) 随机数发生器**，
 *   9 个函数各自按 **lodash 4.18.1 的真实算法**消费它：
 *
 *   | 调用形态 | lodash 真实算法 | `fn = () => 0` 时的结果 |
 *   |---|---|---|
 *   | `random()` | `baseRandom(0, 1)` | `0` |
 *   | `random(5)` | `baseRandom(0, 5)` | `0` |
 *   | `random(true)` / `random(0,1,true)` | 浮点分支 | `0` |
 *   | `random(5, true)` | 浮点分支 `min(0 + 0*(5-0+ε), 5)` | `0` |
 *   | `random(-5, 10)` | `baseRandom(-5, 10)` | `-5`（**区间下界**） |
 *   | `random(...[8,15])` | 同上（参数展开后同形） | `8` |
 *   | `sample(arr)` | `arr[baseRandom(0, len-1)]` | `arr[0]` |
 *   | `sampleSize(arr, n)` | `shuffleSelf(arr, n)`（Fisher-Yates） | `arr.slice(0, n)` |
 *
 * 即：**注入 `() => 0` 就等价于 P0 基准脚本里那把"恒取区间下界 / 首元素"的
 * 桩**（`dev-server/tools/verify-ejs-golden.ts` 的 `installDeterministicRandom`）。
 * ⇒ 不需要"把这个文件里的 random 整个换掉"，只需保证**两边同源**。
 *
 * ⚠️ **该等价性有一处精确边界**（verify-engine 复验时点出，留档以免后人误判）：
 * P0 桩对**浮点单参形态**写的是 `lower / 2`，本文件走的是 **lodash 的真实浮点公式**
 * `min(lo + rand*(hi-lo+ε), hi)` —— 所以 `random(5, true)` 在 `fn = () => 0` 时
 * P0 桩给 `2.5`、本文件给 `0`。这是**两个测试替身之间**的确定值差异。
 *
 * ★ **真 lodash 已作为机器化 oracle 确认过**（不靠推断，两边都实测）：
 * 用「加载前钉死」手法拿到 nativeRandom 被钉住的真 lodash 4.18.1 ——
 * `require.resolve("lodash")` → 存下 `require.cache` 条目 → 改 `Math.random` →
 * `delete require.cache[key]` → 重新 `require` → `try/finally` 复原两者
 * （即 `Math.random` 的捕获发生在**加载期**，加载**前**改它是有效的；
 *  加载**后**改则无效 —— 见下面那条"反面必读"）。
 * 该 oracle 下 `Math.random = () => 0` 时 **`_.random(5, true)` 也给 `0`** ⇒
 * **本文件才是对 lodash 的忠实复刻**，`lower/2` 只是 P0 桩的"形状近似"
 * （只在期望值 `2.5` 上对，确定值上不对）。
 * 独立复现记录：3 条随机源 × 20 种实参形态 = **60 组差异 0**
 * （含浮点单参、反界 `random(10,1)`、`sample` 对象入参、`sampleSize` 的 0/超界/缺省 n）；
 * 源敏感性抽样 `random(5,true)`：`rand=0→0`、`0.9999999→4.999999509999999`、`0.42→2.10042`
 * （两侧逐值相同，证明对拍非恒真）。
 * 影响面：**5 卡 0 命中** —— 实测 23 种 `_.random` 实参形态全是 2 参整数
 * （或 2 元素数组展开），因此 57/57 逐字节比对不受影响；仅"探针断言范围"
 * 需要写清楚是 `random(2 参整数)` / `sample` / `sampleSize`。
 *
 * ⚠️ **反面必读**：lodash 在**模块加载期**就捕获了 `Math.random`（`getNative`），
 * 加载**之后**再改 `Math.random` **不会**影响 `lodash.random/sample/sampleSize` ——
 * 所以"给 lodash 打桩"要么**整体替换那三个函数**（P0 脚本正是这么做的），
 * 要么**在 require 之前**改 `Math.random` 并摘掉 `require.cache`（上面的 oracle 手法）；
 * 本子集则**必须**用 `setRandomSource(fn)`（`Math.random` 直连不算数）。
 *
 * 反向验证（自测方法 §2.3 O6）：同一输入连续渲染两次 ⇒ 逐字节相同；
 * 换另一条序列 ⇒ 输出**确实变化**（证明打桩真的生效，而不是"恰好没用到随机"）。
 * 落地断言见本文件末尾的 `assertLodashSubsetSelfCheck()`。
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 纪律
 * ────────────────────────────────────────────────────────────────────────────
 * - **零依赖**：不 import `lodash`、不 import 任何外部模块（避免 bundle 膨胀，
 *   也避免把 lodash 拉进插件依赖图）。
 * - 叶子模块：不 import `src/plugins/**`，不产生模块环。
 * - 不修改入参对象树（`set` 除外 —— 它按 lodash 语义**就地**写 `object`）。
 * - 无 `eval` / `new Function`。
 */

// ───────────────────────────── 类型 ─────────────────────────────

/** 裸 [0,1) 随机数发生器（可注入）。 */
export type RandomSource = () => number;

/** 路径：`'a.b[0].c'` 形态的字符串，或已切分的键数组（lodash 同形）。 */
export type LodashPath = string | readonly (string | number)[];

/** 本子集对外暴露的 9 个函数（挂到 EJS env 的 `_` 上）。 */
export interface LodashSubset {
  get(obj: unknown, path?: LodashPath, defaultValue?: unknown): unknown;
  has(obj: unknown, path?: LodashPath): boolean;
  set(obj: unknown, path?: LodashPath, value?: unknown): unknown;
  omit(obj: unknown, ...keys: unknown[]): Record<string, unknown>;
  cloneDeep<T>(value: T): T;
  isObject(value: unknown): boolean;
  random(lower?: number | boolean, upper?: number | boolean, floating?: boolean): number;
  sample<T>(collection: readonly T[] | Record<string, T> | null | undefined): T | undefined;
  sampleSize<T>(collection: readonly T[] | Record<string, T> | null | undefined, n?: number): T[];
}

// ───────────────────────── 内部工具（lodash 等价） ─────────────────────────

const hasOwnProperty = Object.prototype.hasOwnProperty;
const objectProto = Object.prototype;
const symToStringTag = typeof Symbol !== "undefined" ? Symbol.toStringTag : undefined;

const INFINITY = 1 / 0;
/** 2^53 —— lodash 用它把 NaN / 负数 / 小数字符串排除在"下标候选"之外。 */
const MAX_SAFE_INTEGER = 9007199254740991;

const MAX_INTEGER = 1.7976931348623157e308;
const NAN = 0 / 0;

/**
 * 路径切分正则 —— **逐字取自 lodash 4.18.1** `rePropName`
 * （三个分支：普通段 / `[数字]` / `['引号段']` / 空段前瞻）。
 * ⚠️ 三个 `;` 是 JS 里嵌入正则字面量的语句分隔符，本份源码把它拼在同一表达式中，
 *    lodash 的 `.source` 里因此**逐字包含** `;` —— 必须原样保留，否则行为不同。
 */
const rePropName =
  /[^.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]|(?=(?:\.|\[\])(?:\.|\[\]|$))/g;
const reEscapeChar = /\\(\\)?/g;
const reIsDeepProp = /\.|\[(?:[^[\]]*|(["'])(?:(?!\1)[^\\]|\\.)*?\1)\]/;
const reIsPlainProp = /^\w*$/;

/** `isSymbol`（lodash）：只有真 Symbol 对象为真。 */
function isSymbol(value: unknown): value is symbol {
  const type = typeof value;
  return (
    type === "symbol" ||
    (!!value &&
      typeof value === "object" &&
      (symToStringTag !== undefined
        ? Object.prototype.toString.call(value) === "[object Symbol]"
        : objectProto.toString.call(value) === "[object Symbol]"))
  );
}

/** `toKey`（lodash）：键归一化为字符串（符号原样）。 */
function toKey(value: unknown): string | symbol {
  if (typeof value === "string" || isSymbol(value)) return value;
  const result = String(value);
  return result === "0" && 1 / (value as number) === -INFINITY ? "-0" : result;
}

/** `isObject`（lodash）：**数组与函数返回 true**；`null` 返回 false。 */
function isObjectLike(value: unknown): value is object {
  const type = typeof value;
  return value != null && (type === "object" || type === "function");
}

/** `stringToPath`（lodash）：`'a.b[0].c'` → `['a','b','0','c']`。 */
function stringToPath(path: string): string[] {
  const result: string[] = [];
  if (path.charCodeAt(0) === 46 /* . */) result.push("");
  path.replace(rePropName, (match: string, number?: string, quote?: string, subString?: string) => {
    result.push(quote ? String(subString).replace(reEscapeChar, "$1") : number || match);
    return "";
  });
  return result;
}

/** `castPath`（lodash 的常用分支）：已是数组 ⇒ 浅拷贝一份键；字符串 ⇒ 切分。 */
function castPath(path: LodashPath): string[] {
  if (Array.isArray(path)) return path.map((k) => String(k));
  const s = typeof path === "string" ? path : String(path);
  if (reIsPlainProp.test(s) && !reIsDeepProp.test(s)) return [s];
  return stringToPath(s);
}

/** `baseGet`（lodash）：不存在 ⇒ `undefined`。 */
function baseGet(object: unknown, path: string[]): unknown {
  let index = 0;
  const length = path.length;
  let current: unknown = object;
  while (current != null && index < length) {
    current = (current as Record<string, unknown>)[toKey(path[index++]) as string];
  }
  return index && index === length ? current : undefined;
}

/** `baseHas`（lodash）：只认**自有**属性（`Object.prototype` 的方法不算）。 */
function baseHas(object: unknown, key: string | symbol): boolean {
  return object != null && hasOwnProperty.call(object, key);
}

/** `isLength`（lodash）：合法的"数组长度"形态。 */
function isLength(value: unknown): boolean {
  return (
    typeof value === "number" && value > -1 && value % 1 === 0 && value <= MAX_SAFE_INTEGER
  );
}

/** `isIndex`（lodash）：用于判断"下一段是不是数组下标"（决定建数组还是对象）。 */
function isIndex(value: unknown, length?: number): boolean {
  const len = length == null ? MAX_SAFE_INTEGER : length;
  const type = typeof value;
  return (
    !!len &&
    (type === "number" || (type !== "symbol" && /^(?:0|[1-9]\d*)$/.test(String(value)))) &&
    (value as number) > -1 &&
    (value as number) % 1 === 0 &&
    (value as number) < len
  );
}

/**
 * `hasPath`（lodash）：逐段**自有**属性检查。
 * 末尾那段是 lodash 的"稀疏数组/arguments 兜底分支"：仅当容器真的是 Array 且
 * 末段是合法下标时才成立 —— 本子集只按数组实现（`arguments` 不会出现在 JSON 里）。
 */
function hasPath(object: unknown, path: string[]): boolean {
  let index = -1;
  const length = path.length;
  let result = false;
  let current: unknown = object;
  let key: string | symbol = "";
  while (++index < length) {
    key = toKey(path[index]);
    if (!(result = current != null && baseHas(current, key))) break;
    current = (current as Record<string, unknown>)[key as string];
  }
  if (result || ++index !== length) return result;
  const len = current == null ? 0 : (current as { length?: unknown }).length;
  return !!len && isLength(len) && isIndex(key, len as number) && Array.isArray(current);
}

/**
 * `toFinite`（lodash）：非数字 ⇒ 尽力转数字；`Infinity` ⇒ ±`MAX_INTEGER`；
 * 转不成 ⇒ `0`（**不是 NaN** —— 与 `toNumber` 的关键差异）。
 */
function toFinite(value: unknown): number {
  if (!value) return value === 0 ? (value as number) : 0;
  const num = toNumber(value);
  if (num === INFINITY || num === -INFINITY) {
    const sign = num < 0 ? -1 : 1;
    return sign * MAX_INTEGER;
  }
  return num === num ? num : 0;
}

/** `toNumber`（lodash 的常用分支；十六/八进制字符串字面量对本子集无实际影响）。 */
function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (isSymbol(value)) return NAN;
  let v: unknown = value;
  if (isObjectLike(v)) {
    const other = typeof (v as { valueOf?: unknown }).valueOf === "function"
      ? (v as { valueOf: () => unknown }).valueOf()
      : v;
    v = isObjectLike(other) ? other + "" : other;
  } else if (typeof v !== "string") {
    return v === 0 ? (v as number) : Number(v);
  }
  const text = String(v).trim();
  return text === "" ? 0 : Number(text);
}

/** `toInteger`（lodash）：截断小数；非有限 ⇒ 0。 */
function toInteger(value: unknown): number {
  const result = toFinite(value);
  const remainder = result % 1;
  return result === result ? (remainder ? result - remainder : result) : 0;
}

/** `baseClamp`（lodash）。 */
function baseClamp(number: number, lower?: number, upper?: number): number {
  let n = number;
  if (n === n) {
    if (upper !== undefined) n = n <= upper ? n : upper;
    if (lower !== undefined) n = n >= lower ? n : lower;
  }
  return n;
}

/** `baseRandom`（lodash）：**整数**分支 ⇒ `lower + floor(rand * (upper - lower + 1))`。 */
function baseRandom(lower: number, upper: number): number {
  return lower + Math.floor(randomSource() * (upper - lower + 1));
}

/** `copyArray`（lodash）。 */
function copyArray<T>(source: readonly T[] | { length: number }): T[] {
  const length = (source as { length: number }).length;
  const array = new Array<T>(length);
  for (let i = 0; i < length; i++) array[i] = (source as readonly T[])[i];
  return array;
}

/** `shuffleSelf`（lodash）：Fisher-Yates，**前 size 个**被洗牌后返回。 */
function shuffleSelf<T>(array: T[], size?: number): T[] {
  const length = array.length;
  const lastIndex = length - 1;
  const n = size === undefined ? length : size;
  let index = -1;
  while (++index < n) {
    const rand = baseRandom(index, lastIndex);
    const value = array[rand];
    array[rand] = array[index];
    array[index] = value;
  }
  array.length = n;
  return array;
}

/** `values`（lodash，仅对象入参；数组走各自的快路径）。 */
function valuesOf(collection: unknown): unknown[] {
  if (collection == null) return [];
  return Object.keys(Object(collection)).map((k) => (collection as Record<string, unknown>)[k]);
}

// ───────────────────────────── 随机源 ─────────────────────────────

/** 默认随机源 = `Math.random`（真随机，保真 ST；D15）。 */
let randomSource: RandomSource = Math.random;

/** 默认源（`Math.random` 的引用；`setRandomSource(null)` 用它复位）。 */
const defaultRandomSource: RandomSource = Math.random;

/**
 * 注入可控随机源（**仅测试/基准使用**，D15）。
 *
 * `fn` 必须是**裸 [0,1) 发生器**（不是"预置答案数组"）—— 9 个函数按
 * lodash 真实算法消费它，见文件头的对照表。`fn = () => 0` 即等价于 P0
 * 基准脚本的"恒取下界"桩；`fn = null` ⇒ 复位为默认的 `Math.random`。
 *
 * @returns 还原函数（`restore()` ⇒ 回到**注入前**的源），便于测试收尾。
 *          测试收尾用 `restore()` 或 `setRandomSource(null)` 都可以。
 * @example
 * const restore = setRandomSource(() => 0);
 * random(-5, 10); // ⇒ -5（与 P0 基准逐字节一致）
 * restore();
 * @example
 * setRandomSource(null); // ⇒ 交还真随机（保真 ST）
 */
export function setRandomSource(fn: RandomSource | null): () => void {
  if (fn !== null && typeof fn !== "function") {
    throw new TypeError("setRandomSource(fn): fn 必须是 () => [0,1) 的函数，或 null（复位）");
  }
  const prev = randomSource;
  randomSource = fn === null ? defaultRandomSource : fn;
  return () => {
    randomSource = prev;
  };
}

/** 当前随机源（只读诊断用），见插件 UI 的"本轮渲染统计"快照。 */
export function getRandomSource(): RandomSource {
  return randomSource;
}

/** 恢复默认随机源（等价于 `setRandomSource(null)`）。 */
export function resetRandomSource(): void {
  randomSource = defaultRandomSource;
}

// ───────────────────────────── 9 个函数 ─────────────────────────────

/**
 * `_.get(obj, path, default)` —— 支持 `a.b[0].c` 与 `a[0]`；缺失 ⇒ `default`。
 *
 * ⚠️ lodash 语义：**即使路径存在、但取到的值是 `undefined`，也返回 `default`**
 * （实测 212 次，是模板里最常用的"取值兜底"写法）。
 */
export function get(obj: unknown, path?: LodashPath, defaultValue?: unknown): unknown {
  const value = obj == null ? undefined : baseGet(obj, castPath(path));
  return value === undefined ? defaultValue : value;
}

/**
 * `_.has(obj, path)` —— 路径**逐段都必须是自有属性**；缺失 ⇒ `false`。
 * （实验证 `Object.prototype` 上的方法**不算**命中：`_.has({}, 'toString') === false`。）
 */
export function has(obj: unknown, path?: LodashPath): boolean {
  if (path === undefined) return false;
  if (obj == null) return false;
  return hasPath(obj, castPath(path));
}

/**
 * `_.set(obj, path, value)` —— 按路径**就地**写入（中间层缺失则创建；
 * 下一段是合法下标则建数组，否则建对象），返回 `object` 本身。
 *
 * ⚠️ 这是本子集里**唯一会改写入参**的函数（lodash 语义如此），
 * 模板里的用法见 `_.set(displayOutput, displayPath, calendar)`。
 * ⚠️ 与 lodash 一致：`path === undefined` ⇒ 视作键 `'undefined'`（**不是**空操作）；
 * 只有 `obj` 不是对象时才原样返回。
 */
export function set(obj: unknown, path?: LodashPath, value?: unknown): unknown {
  if (!isObjectLike(obj)) return obj;
  const segments = Array.isArray(path)
    ? path.map((k) => toKey(k))
    : reIsDeepProp.test(String(path))
      ? castPath(path)
      : [toKey(path)];
  if (segments.length === 0) return obj;

  let nested: Record<string, unknown> = obj as Record<string, unknown>;
  const lastIndex = segments.length - 1;
  for (let index = 0; index <= lastIndex; index++) {
    const key = segments[index] as string;
    if (index === lastIndex) {
      baseAssignValue(nested, key, value);
      break;
    }
    const next = nested[key];
    let assigned: unknown;
    if (isObjectLike(next)) {
      assigned = next;
    } else {
      const nextKey = segments[index + 1];
      assigned = isIndex(nextKey) ? [] : {};
    }
    baseAssignValue(nested, key, assigned);
    nested = assigned as Record<string, unknown>;
  }
  return obj;
}

/** `baseAssignValue`（lodash）：`'__proto__'` 必须用 defineProperty 写（防原型污染）。 */
function baseAssignValue(object: Record<string, unknown>, key: string, value: unknown): void {
  if (key === "__proto__") {
    Object.defineProperty(object, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  } else {
    object[key] = value;
  }
}

/**
 * `baseUnset`（lodash）：按路径删除属性。
 * @returns 是否**真的删掉了**（命中自有属性为 `true`；路径不存在、只截断值类型为 `false`）
 */
function baseUnset(object: unknown, path: LodashPath): boolean {
  const keys = castPath(path);
  let current: unknown = object;
  let key: string | symbol = "";
  for (let i = 0; i < keys.length - 1; i++) {
    key = toKey(keys[i]);
    const next = current == null ? undefined : (current as Record<string, unknown>)[key as string];
    if (next == null || !isObjectLike(next)) return false;
    current = next;
  }
  key = toKey(keys[keys.length - 1]);
  return (
    current != null &&
    hasOwnProperty.call(Object(current), key) &&
    delete (current as Record<string, unknown>)[key as string]
  );
}

/**
 * `_.omit(obj, ...keys)` —— 返回**浅拷贝**且按路径排除（lodash `baseUnset` 语义）。
 *
 * 关键细节（与 lodash 逐项对齐）：路径取不到东西时**什么都不删** ——
 * 所以 `_.omit({a:{b:1},c:2}, 'a.b')` 得 `{a:{},c:2}`（`a` 还在，只是空了），
 * 而不是把 `a` 整个删掉。
 * 可传数组或点路径字符串；只处理**自有**属性。
 */
export function omit(obj: unknown, ...keys: unknown[]): Record<string, unknown> {
  if (obj == null) return {};
  const result: Record<string, unknown> = Object.assign({}, obj);
  const flat = keys.length === 1 && Array.isArray(keys[0]) ? (keys[0] as unknown[]) : keys;
  for (const key of flat) {
    if (key == null) continue;
    baseUnset(result, key as LodashPath);
  }
  return result;
}

/**
 * `_.cloneDeep(value)` —— 深拷贝，**循环引用安全**（WeakMap 记忆化）。
 * 覆盖 Array / Date / RegExp / Map / Set / 普通对象。
 *
 * 两处**有意偏离 lodash**（均为保守选择，实测 1 次调用只喂普通对象，不受影响）：
 * - 函数：lodash 会返回一个"原型为 `Function.prototype` 的空对象"；
 *   这里原样返回函数本身（更不意外）。
 * - 原型未知的对象（class 实例）：lodash 会造一个同原型但**丢字段**的空壳；
 *   这里原样返回，绝不返回半成品。
 */
export function cloneDeep<T>(value: T, seen?: WeakMap<object, unknown>): T {
  if (value === null || typeof value !== "object") return value; // 含函数/基本类型
  const map = seen ?? new WeakMap<object, unknown>();
  const cached = map.get(value as object);
  if (cached !== undefined) return cached as T;

  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  if (value instanceof RegExp) return new RegExp(value.source, value.flags) as unknown as T;

  if (value instanceof Map) {
    const out = new Map();
    map.set(value as object, out);
    value.forEach((v, k) => {
      out.set(cloneDeep(k, map), cloneDeep(v, map));
    });
    return out as unknown as T;
  }
  if (value instanceof Set) {
    const out = new Set();
    map.set(value as object, out);
    value.forEach((v) => {
      out.add(cloneDeep(v, map));
    });
    return out as unknown as T;
  }

  if (Array.isArray(value)) {
    const out = new Array(value.length);
    map.set(value as object, out);
    for (let i = 0; i < value.length; i++) out[i] = cloneDeep(value[i], map);
    return out as unknown as T;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== objectProto && proto !== null) return value;

  const out: Record<string, unknown> = {};
  map.set(value as object, out);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    out[key] = cloneDeep((value as Record<string, unknown>)[key], map);
  }
  return out as unknown as T;
}

/**
 * `_.isObject(value)` —— **数组与函数返回 `true`**（lodash 语义，勿用 `typeof !== 'object'` 判）；
 * `null` 返回 `false`。
 * 实测用法：`if (!_.isObject(_.get(data, displayPath))) { … }`。
 */
export function isObject(value: unknown): boolean {
  return isObjectLike(value);
}

/**
 * `_.random(lower, upper, floating)` —— 区间随机数（**走可注入随机源**）。
 *
 * 与 lodash 逐条对齐的关键点：
 * - 单参 `random(5)` ⇒ `[0, 5]`（不是 `[5, 5]`）；`random(-5)` ⇒ `[-5, 0]`。
 * - 布尔形参位移：`random(true)` / `random(5, true)` ⇒ 浮点。
 * - `lower > upper` ⇒ **交换**。
 * - 任一界非整数 ⇒ 自动走浮点分支（模板里的 `_.random(...damageRange)` 即此类）。
 * - 整数分支 = `lower + floor(rand * (upper - lower + 1))`（两端**闭区间**）。
 */
export function random(
  lower?: number | boolean,
  upper?: number | boolean,
  floating?: boolean,
): number {
  if (floating === undefined) {
    if (typeof upper === "boolean") {
      floating = upper;
      upper = undefined;
    } else if (typeof lower === "boolean") {
      floating = lower;
      lower = undefined;
    }
  }

  let lo: number;
  let hi: number;
  if (lower === undefined && upper === undefined) {
    lo = 0;
    hi = 1;
  } else {
    lo = toFinite(lower);
    if (upper === undefined) {
      hi = lo;
      lo = 0;
    } else {
      hi = toFinite(upper);
    }
  }
  if (lo > hi) {
    const temp = lo;
    lo = hi;
    hi = temp;
  }

  const rand = randomSource();
  if (floating || lo % 1 !== 0 || hi % 1 !== 0) {
    // lodash：`min(lower + rand*(upper-lower+epsilon), upper)`，
    // 其中 epsilon = `1e-<rand 字符串长度-1>`（保证上界可取到，且不会越界）。
    const epsilon = Number("1e-" + (String(rand).length - 1));
    return Math.min(lo + rand * (hi - lo + epsilon), hi);
  }
  return baseRandom(lo, hi);
}

/** `_.sample(arr)` —— 数组取随机一个元素；空数组/空集合 ⇒ `undefined`。 */
export function sample<T>(collection: readonly T[] | Record<string, T> | null | undefined): T | undefined {
  if (collection == null) return undefined;
  const array: unknown[] = Array.isArray(collection) ? collection : valuesOf(collection);
  const length = array.length;
  return length ? (array[baseRandom(0, length - 1)] as T) : undefined;
}

/** `_.sampleSize(arr, n)` —— 洗牌取前 `n` 个；`n` 缺省 1，超界则截到 `arr.length`。 */
export function sampleSize<T>(
  collection: readonly T[] | Record<string, T> | null | undefined,
  n?: number,
): T[] {
  if (collection == null) return [];
  const array: unknown[] = Array.isArray(collection) ? copyArray(collection) : valuesOf(collection);
  const size = n === undefined ? 1 : toInteger(n);
  return shuffleSelf(array, baseClamp(size, 0, array.length)) as T[];
}

// ───────────────────────────── 集合导出 ─────────────────────────────

/**
 * 挂到 EJS env 上的 `_` 对象（与 lodash 同形）：
 *
 * ```ts
 * const env = { _: lodashSubset, getvar, setvar, getwi, YAML };
 * ```
 *
 * 注意 `random` / `sample` / `sampleSize` 是**引用本模块的随机源**的
 * （不是 `Math.random` 直连），因此 `setRandomSource()` 对它们立即生效。
 */
export const lodashSubset: LodashSubset = {
  get,
  has,
  set,
  omit,
  cloneDeep,
  isObject,
  random,
  sample,
  sampleSize,
};

export const LODASH_SUBSET_FNS = [
  "get",
  "has",
  "set",
  "omit",
  "cloneDeep",
  "isObject",
  "random",
  "sample",
  "sampleSize",
] as const;

export type LodashSubsetFnName = (typeof LODASH_SUBSET_FNS)[number];

// ───────────────────────────── 自检 ─────────────────────────────

/**
 * 零依赖自检（**不 import lodash、不读文件、不联网**）：把本文件的关键语义
 * 与"P0 黄金基准所依赖的桩行为"钉成可执行断言。
 *
 * 谁该调它：
 * - P1/P3 验证器（`dev-server/tools/verify-ejs-engine.ts`）在跑黄金比对**之前**先调一次，
 *   把"子集自身没坏"与"模板渲染差异"分开归因；
 * - 插件 UI 的"试渲染"（可选）。
 *
 * @param log 可选的失败收集器（默认 `console.error`）；返回失败条目数（0 = 全绿）。
 */
export function assertLodashSubsetSelfCheck(log?: (message: string) => void): number {
  const report = log ?? ((m: string) => console.error(m));
  const problems: string[] = [];
  const eq = (label: string, actual: unknown, expected: unknown) => {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) problems.push(`${label}: 实际 ${a} ≠ 期望 ${b}`);
  };

  // ── get / has（路径与兜底）──
  const tree = { a: { b: [{ c: "C0" }, { c: "C1" }] } };
  eq("get(a.b[0].c)", get(tree, "a.b[0].c"), "C0");
  eq("get(a.b[1].c)", get(tree, "a.b[1].c"), "C1");
  eq("get(缺失, 默认)", get(tree, "a.z", "D"), "D");
  eq("get(值为 undefined, 默认)", get({ a: undefined }, "a", "D"), "D");
  eq("get(值为 null 不兜底)", get({ a: null }, "a", "D"), null);
  eq("get(obj, undefined)", get(tree, undefined), undefined);
  eq("has(a.b[0])", has(tree, "a.b[0]"), true);
  eq("has(缺失)", has(tree, "a.b[9]"), false);
  eq("has(继承属性不算)", has({}, "toString"), false);
  eq("has(obj, undefined)", has(tree, undefined), false);

  // ── set（就地写 + 数组/对象自动建层）──
  const target: Record<string, unknown> = {};
  set(target, "a.b[0].c", 7);
  eq("set(a.b[0].c)", target, { a: { b: [{ c: 7 }] } });
  const target2: Record<string, unknown> = { a: null };
  set(target2, "a.b", 1);
  eq("set(越过 null)", target2, { a: { b: 1 } });
  eq("set(undefined 路径 ⇒ 键 'undefined')", set({ a: 1 }, undefined, 5), { a: 1, undefined: 5 });

  // ── omit（浅拷贝 + 路径取不到就不动）──
  eq("omit 单键", omit({ a: 1, b: 2 }, "a"), { b: 2 });
  eq("omit 多键", omit({ a: 1, b: 2, c: 3 }, "a", "c"), { b: 2 });
  eq("omit 深路径不动头", omit({ a: { b: 1 }, c: 2 }, "a.b"), { a: {}, c: 2 });

  // ── cloneDeep（独立性 + 循环引用）──
  const src = { x: { y: [1, 2, 3] } };
  const copy = cloneDeep(src);
  eq("cloneDeep 值相等", copy, src);
  if (copy === src || copy.x === src.x || copy.x.y === src.x.y) {
    problems.push("cloneDeep: 未深拷贝（存在引用共享）");
  }
  const cyc: Record<string, unknown> = { a: 1 };
  cyc.self = cyc;
  const cycCopy = cloneDeep(cyc);
  if (cycCopy === cyc || cycCopy.self !== cycCopy) problems.push("cloneDeep: 循环引用未记忆化");

  // ── isObject（数组与函数为 true —— lodash 语义）──
  eq("isObject([])", isObject([]), true);
  eq("isObject(() => {})", isObject(() => {}), true);
  eq("isObject({})", isObject({}), true);
  eq("isObject(null)", isObject(null), false);
  eq("isObject(1)", isObject(1), false);
  eq("isObject('s')", isObject("s"), false);
  eq("isObject(undefined)", isObject(undefined), false);

  // ── random / sample / sampleSize（可控随机源 + P0 桩等价）──
  const restore = setRandomSource(() => 0);
  try {
    eq("random(-5,10) @0", random(-5, 10), -5);
    eq("random(5) @0", random(5), 0);
    eq("random(1,6) @0", random(1, 6), 1);
    eq("sample @0", sample([9, 8, 7]), 9);
    eq("sample(空)", sample([]), undefined);
    eq("sampleSize(...,2) @0", sampleSize([9, 8, 7], 2), [9, 8]);
    eq("sampleSize(n=0)", sampleSize([9, 8, 7], 0), []);
    eq("sampleSize(n 超界)", sampleSize([9, 8, 7], 9), [9, 8, 7]);
    const first = [random(-5, 10), sample([9, 8, 7]), sampleSize([9, 8, 7], 2)];
    const second = [random(-5, 10), sample([9, 8, 7]), sampleSize([9, 8, 7], 2)];
    eq("同源两次逐字节相同", first, second);
  } finally {
    restore();
  }
  const restore2 = setRandomSource(() => 0.9999999);
  try {
    const r = random(-5, 10);
    const s = sample([9, 8, 7]);
    if (r === -5 || s === 9) problems.push("随机源换序列后输出没变化（打桩可能没生效）");
    if (r > 10 || r < -5) problems.push(`random 越界: ${r}`);
  } finally {
    restore2();
  }

  // `setRandomSource(null)` ⇒ 复位为真随机（契约形态之一）
  {
    const restore3 = setRandomSource(() => 0);
    const forced = random(-5, 10);
    setRandomSource(null);
    const back = [random(1, 6), random(1, 6), random(1, 6), random(1, 6), random(1, 6), random(1, 6)];
    if (forced !== -5) problems.push(`setRandomSource(()=>0) 未生效: random(-5,10)=${forced}`);
    if (back.every((v) => v === 1)) problems.push("setRandomSource(null) 后仍是固定源（复位失败）");
    restore3();
    setRandomSource(null);
  }

  // 非函数、非 null ⇒ 显式抛错（不静默）
  {
    let threw = false;
    try {
      (setRandomSource as unknown as (f: unknown) => unknown)(123);
    } catch {
      threw = true;
    }
    if (!threw) problems.push("setRandomSource(123) 未抛错");
  }

  for (const p of problems) report(`[lodashSubset 自检] ${p}`);
  return problems.length;
}
