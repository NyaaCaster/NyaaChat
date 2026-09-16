import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import {
  AlertTriangle,
  ArrowLeft,
  Book,
  Flame,
  GripVertical,
  Loader2,
  MessageSquare,
  Puzzle,
  Search,
  Settings,
  Sparkles,
  Volume2,
  VolumeX,
  type LucideIcon,
} from "lucide-react";
import type { NyaaPlugin, PluginState, PluginStateMap } from "../plugins/types";
import {
  callPluginBackend,
  getPluginBackendDeclaration,
  getPluginRuntimeSnapshot,
  getRegisteredPlugins,
  mergePluginDefaults,
  subscribePluginRuntime,
  updatePluginConfig,
} from "../plugins";
import {
  clearPluginErrors,
  getPluginErrorCounts,
  getPluginErrors,
  subscribePluginErrors,
  type PluginLogRecord,
} from "../plugins/pluginLog";
import { useAppSettings } from "../lib/settingsContext";
import { BaseModal } from "./BaseModal";
import { ToggleSwitch } from "./SettingsFormBits";

interface ExtensionsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** 空态 / 缺字段的占位文案（SSOT §2.5：无 SettingsPanel 时必须有明确占位）。 */
const NO_DESCRIPTION_TEXT = "该插件未提供说明";
const NO_SETTINGS_TEXT = "该插件没有可配置项";
const EMPTY_REGISTRY_TEXT = "当前没有已注册的插件";
const EMPTY_SEARCH_TEXT = "没有匹配的插件";

/**
 * 插件图标**显式允许集**：`meta.icon` 是 lucide 的**导出名**，这里按名映射到
 * 具名导入的组件。
 *
 * ⚠️ **不要改回 `import * as LucideIcons from "lucide-react"` + 动态取属性**：
 * 命名空间导入会让打包器把整套 lucide（约 1700 个图标）拉进主 chunk —— 同一轮
 * bundler 的 A/B 实测：主 chunk 从 **1,410.74 kB 涨到 2,240.29 kB（+829.55 kB /
 * +37%），gzip 586.44 kB vs 433.35 kB**，而实际用到的只有下面这几个。具名导入 +
 * 显式映射把体积压回来，同时保留"插件用图标名声明"的契约。
 *
 * 代价（明确登记）：插件只能从这个表里挑图标，写表外的名字会回退到 `Puzzle` 并
 * 在控制台给出提示（提示里会列出可选值）。需要新图标时在这里加一行具名导入 +
 * 一条映射即可。当前真实插件 `quote-tts` 用的是 `Volume2`。
 */
const PLUGIN_ICONS: Record<string, LucideIcon> = {
  AlertTriangle,
  ArrowLeft,
  Book,
  Flame,
  Loader2,
  MessageSquare,
  Puzzle,
  Search,
  Settings,
  Sparkles,
  Volume2,
  VolumeX,
};

/** 按名解析插件图标；未登记的名字回退「扩展」入口图标并从控制台提示。
 *
 *  作为**具名导出**暴露（模块仍以 default 导出组件）：让"允许集"与回退分支可被
 *  外部核对与单测覆盖 —— 回退分支在真实注册表里很难构造。 */
export function resolvePluginIcon(name: string | undefined): LucideIcon {
  if (!name) return Puzzle;
  const icon = PLUGIN_ICONS[name];
  if (!icon) {
    console.warn(
      `[plugins] 图标 "${name}" 不在允许集内，回退到 Puzzle（可选值：${Object.keys(PLUGIN_ICONS).join(", ")}）`,
    );
    return Puzzle;
  }
  return icon;
}

/** 当前允许的图标名（排序），供插件作者与测试核对。 */
export const PLUGIN_ICON_NAMES: readonly string[] = Object.keys(PLUGIN_ICONS).sort();

function pluginMatches(plugin: NyaaPlugin, keyword: string): boolean {
  const trimmed = keyword.trim().toLowerCase();
  if (!trimmed) return true;
  return (
    plugin.meta.name.toLowerCase().includes(trimmed) ||
    plugin.meta.id.toLowerCase().includes(trimmed)
  );
}

/**
 * 「扩展」面板（SSOT §2.5 / 审计报告 D2）。
 *
 * 版式对齐 `对话模型供应商`（LlmProvidersModal）：PC 左列表右详情，手机两级
 * （`返回列表` 可回）。响应式**完全复用** `src/index.css` 的 `.pv-layout` /
 * `.pv-pane-list` / `.pv-pane-detail` / `.pv-pane-hidden` / `.pv-only-mobile`
 * （40rem 断点，`!important`），本组件不写任何 `@media`，也不用 JS 判宽。
 *
 * **列表的唯一权威是代码**（`plugins/registry.ts` 经 `getRegisteredPlugins()`），
 * 绝不遍历 `AppState.plugins` 的键 —— 开发者删掉一个插件后用户不该再看见它
 * （SSOT §2.8.4 / 验证矩阵 V17）。
 *
 * 启用状态与配置都从插件运行时快照读取（`useSyncExternalStore`），写入走
 * `updatePluginConfig` → `App.tsx` 注册的 writer → `handleSaveSettings()`，
 * 因此开关必然落盘，且配置变更后 UI 自动更新。
 */
export function ExtensionsModal({ isOpen, onClose }: ExtensionsModalProps) {
  // 注册表是模块级常量数组，引用稳定；排序由 `plugins/registry.ts` 负责。
  const plugins = getRegisteredPlugins();

  // 运行时快照（enabled + 已深合并 defaults 的 config）。
  const runtimeSnapshot: PluginStateMap = useSyncExternalStore(
    subscribePluginRuntime,
    getPluginRuntimeSnapshot,
  );

  // P6 观测层：**错误计数**快照（引用稳定，仅在记录变更时替换）—— 列表行角标用。
  // 详情页的「运行日志」区在 `PluginDetail` 内单独订阅同一个 store（按 pluginId 取记录），
  // 这样"某个插件新报一条错"只重渲染它的详情页，而不是整张列表。
  const errorCounts: Record<string, number> = useSyncExternalStore(
    subscribePluginErrors,
    getPluginErrorCounts,
  );

  // 启用/停用必须写进 `AppState.plugins[id].enabled`（运行时快照只是只读视图，
  // `updatePluginConfig` 只写 config）。本组件是"没有 settings prop 的叶子 modal"，
  // 正是 `useAppSettings` 存在的场景（见 src/lib/settingsContext.tsx 顶部说明）。
  const appSettings = useAppSettings();
  // 开关回调用 ref 读最新设置：它只注册一次（[] 依赖），闭包不能捕获过期快照。
  const appSettingsRef = useRef(appSettings);
  appSettingsRef.current = appSettings;

  const [selectedId, setSelectedId] = useState<string>(plugins[0]?.meta.id ?? "");
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [keyword, setKeyword] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  // ── 用户自定义排序（纯 UI 偏好，`AppState.pluginOrder`）────────────────────
  // 列表顺序 = 用户排过的 id（按存档顺序）→ 其余按注册表顺序补齐。新增插件因此
  // 天然出现在队尾，不会因为用户旧排序而消失。**不影响任何插件逻辑**。
  const orderedPlugins = useMemo(() => {
    const order = appSettings?.settings.pluginOrder ?? [];
    if (order.length === 0) return plugins;
    const rank = new Map(order.map((id, index) => [id, index]));
    // 未列到的排到最后（Number.MAX_SAFE_INTEGER）；`sort` 稳定 ⇒ 它们保持注册表顺序。
    return [...plugins].sort(
      (a, b) =>
        (rank.get(a.meta.id) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.meta.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [plugins, appSettings]);

  const orderedVisiblePlugins = useMemo(
    () => orderedPlugins.filter((plugin) => pluginMatches(plugin, keyword)),
    [orderedPlugins, keyword],
  );

  // `onDragEnd` 只注册一次（[] 依赖），闭包不能捕获过期的列表快照 ⇒ 走 ref 读最新值
  // （与 `appSettingsRef` 同一手法）。
  const orderedPluginsRef = useRef(orderedPlugins);
  orderedPluginsRef.current = orderedPlugins;
  const orderedVisiblePluginsRef = useRef(orderedVisiblePlugins);
  orderedVisiblePluginsRef.current = orderedVisiblePlugins;

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /**
   * 拖动结束 → 落盘新的显示顺序。
   *
   * ⚠️ 搜索过滤时**不能**直接把可见列表的顺序当成全量顺序：这里先把可见 id 做
   * `arrayMove`，再把它们在**全量顺序**中所占的那些位置依次替换回去 —— 未被搜索
   * 命中的插件位置保持不变。这样"边搜边拖"不会打乱被过滤掉的插件。
   */
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const ctx = appSettingsRef.current;
    if (!ctx) return;

    const fullIds = orderedPluginsRef.current.map((plugin) => plugin.meta.id);
    const visIds = orderedVisiblePluginsRef.current.map((plugin) => plugin.meta.id);
    const from = visIds.indexOf(String(active.id));
    const to = visIds.indexOf(String(over.id));
    if (from < 0 || to < 0) return;

    const nextVisible = arrayMove(visIds, from, to);
    let cursor = 0;
    const nextFull = fullIds.map((id) => (visIds.includes(id) ? nextVisible[cursor++] : id));

    try {
      ctx.onSettingsChange({ ...ctx.settings, pluginOrder: nextFull });
      setSaveFailed(false);
    } catch (err) {
      console.error("[plugins] 保存插件显示顺序失败", err);
      setSaveFailed(true);
    }
  }, []);

  // 选中的插件被下线 / 被搜索过滤掉时，回落到列表首项，避免详情面板悬空。
  const selected =
    orderedVisiblePlugins.find((plugin) => plugin.meta.id === selectedId) ??
    orderedVisiblePlugins[0];

  const handleSelect = (pluginId: string) => {
    setSelectedId(pluginId);
    setMobileView("detail");
  };

  // 开关落盘：每次渲染都从最新快照（+ 设置上下文）里取值，因此连续点击不会用
  // 过期的 enabled 互相覆盖。`onSettingsChange` 就是 `handleSaveSettings`，
  // ⇒ 必然写进设置存档。
  const handleToggleEnabled = useCallback(
    (plugin: NyaaPlugin, next: boolean) => {
      // 延后到微任务标记"写入中"：同步 setState 会在写入抛错时留下一个永远
      // 不落地的 spinner。
      setPendingId(plugin.meta.id);
      queueMicrotask(() => {
        try {
          const ctx = appSettingsRef.current;
          if (!ctx) {
            throw new Error("设置上下文不可用（ExtensionsModal 渲染在 SettingsProvider 之外？）");
          }
          const current = ctx.settings.plugins[plugin.meta.id];
          ctx.onSettingsChange({
            ...ctx.settings,
            plugins: {
              ...ctx.settings.plugins,
              [plugin.meta.id]: {
                enabled: next,
                config: current?.config ?? {},
              },
            },
          });
          setSaveFailed(false);
        } catch (err) {
          console.error(`[plugins] 切换插件 "${plugin.meta.id}" 的启用状态失败`, err);
          setSaveFailed(true);
        } finally {
          setPendingId(null);
        }
      });
    },
    [],
  );

  // 快照只保存「存档里出现过的插件」；用户还没启用过的插件不在快照里，此时配置
  // 必须回落成 `defaults`（与 `getPluginConfig` 的语义一致），否则设置面板会看到
  // 一份空配置、把默认值显示成 undefined。
  const stateOf = (plugin: NyaaPlugin): PluginState => {
    const stored = runtimeSnapshot[plugin.meta.id];
    return {
      enabled: stored?.enabled ?? false,
      config: mergePluginDefaults(plugin, stored?.config ?? {}),
    };
  };

  const renderListPane = () => (
    <div
      className={`pv-pane-list ${
        mobileView === "detail" ? "pv-pane-hidden" : ""
      } flex-col sm:border-r border-gray-200 dark:border-white/10 bg-gray-50/50 dark:bg-black/20 min-h-0`}
    >
      {plugins.length > 1 && (
        <div className="relative flex-shrink-0 p-2 pb-0">
          <Search
            size={14}
            className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索插件"
            aria-label="搜索插件"
            className="w-full pl-8 pr-3 py-2 text-sm rounded-lg bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 focus:border-blue-500 focus:outline-none text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
          />
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-2 min-h-0">
        {plugins.length === 0 ? (
          <p className="p-3 text-sm text-gray-500 dark:text-gray-400">
            {EMPTY_REGISTRY_TEXT}
          </p>
        ) : orderedVisiblePlugins.length === 0 ? (
          <p className="p-3 text-sm text-gray-500 dark:text-gray-400">
            {EMPTY_SEARCH_TEXT}
          </p>
        ) : (
          // 拖动排序：与「对话模型供应商」同款（垂直轴约束 + 手柄拖动）。顺序只影响
          // 显示，落盘在 `AppState.pluginOrder`，不参与任何插件逻辑。
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          >
            <SortableContext
              items={orderedVisiblePlugins.map((plugin) => plugin.meta.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-1 list-none">
                {orderedVisiblePlugins.map((plugin) => (
                  <SortablePluginRow
                    key={plugin.meta.id}
                    plugin={plugin}
                    enabled={stateOf(plugin).enabled}
                    isActive={selected?.meta.id === plugin.meta.id}
                    errorCount={errorCounts[plugin.meta.id] ?? 0}
                    onSelect={() => handleSelect(plugin.meta.id)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );

  const renderDetailPane = () => (
    <div
      className={`pv-pane-detail ${
        mobileView === "list" ? "pv-pane-hidden" : ""
      } flex-col min-h-0 min-w-0`}
    >
      {selected ? (
        <>
          <div className="pv-only-mobile items-center gap-2 p-3 border-b border-gray-200 dark:border-white/10 flex-shrink-0">
            <button
              type="button"
              onClick={() => setMobileView("list")}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
              aria-label="返回插件列表"
            >
              <ArrowLeft size={18} />
            </button>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              返回列表
            </span>
          </div>
          {/* ⚠️ `min-w-0` 必须保留：详情面板是 flex 子项，默认 `min-width:auto` 会被
              内部的 `white-space:nowrap` 内容（如 backend 那行 `font-mono`）撑宽，
              进而在 modal 层产生横向滚动条、并把右侧内容（音色下拉等）切掉。
              `overflow-x-hidden` 是兜底：即使将来又塞进不可断行的长串，也只裁切该串，
              不会让整个 modal 横向滚动。 */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 min-h-0 min-w-0">
            <PluginDetail
              key={selected.meta.id}
              plugin={selected}
              state={stateOf(selected)}
              pending={pendingId === selected.meta.id}
              onToggleEnabled={(next) => handleToggleEnabled(selected, next)}
            />
            {saveFailed && (
              <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                配置未能写入本地设置，请检查存储空间后重试。
              </p>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center p-6 text-sm text-gray-500 dark:text-gray-400">
          {plugins.length === 0 ? EMPTY_REGISTRY_TEXT : "请选择左侧的插件"}
        </div>
      )}
    </div>
  );

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="扩展"
      titleIcon={<Puzzle size={16} className="text-blue-600 dark:text-blue-400" />}
      maxWidth="max-w-5xl"
      // 与「对话模型供应商」一致：点遮罩不关闭，避免误触丢失正在编辑的插件配置。
      closeOnBackdrop={false}
    >
      <div className="pv-layout h-[600px] max-h-[70vh]">
        {renderListPane()}
        {renderDetailPane()}
      </div>
    </BaseModal>
  );
}

/**
 * 可拖动排序的插件列表行（与 `LlmProvidersModal.SortableProviderRow` 同款）。
 *
 * 行内**没有启用开关**（用户 2026-09-15 要求）：启用状态用右侧绿点表示、与供应商
 * 列表一致，开关只放在详情页 —— 这样"点一下选中"与"拖一下排序"都不会误触启用。
 * 行内容也**不显示版本号**（版本与 id 在详情页头部）。
 *
 * P6 增补：该插件有 **error 级**日志时，绿点左侧再显示一个红色小圆点 + 条数
 * （与绿点刻意区分：绿=启用，红=有错误），让"某个插件在静默报错"在列表层就可见。
 */
interface SortablePluginRowProps {
  plugin: NyaaPlugin;
  enabled: boolean;
  isActive: boolean;
  /** 该插件的 error 级日志条数（0 ⇒ 不显示角标）。 */
  errorCount: number;
  onSelect: () => void;
}

function SortablePluginRow({
  plugin,
  enabled,
  isActive,
  errorCount,
  onSelect,
}: SortablePluginRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: plugin.meta.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : "auto",
  };

  const Icon = resolvePluginIcon(plugin.meta.icon);

  return (
    <li ref={setNodeRef} style={style}>
      <div
        className={`flex items-center rounded-lg transition-all ${
          isActive
            ? "bg-blue-500/10 dark:bg-blue-500/20 ring-1 ring-blue-500"
            : "hover:bg-white dark:hover:bg-white/5"
        }`}
      >
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="p-2 cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 touch-none flex-shrink-0"
          aria-label={`拖动排序 ${plugin.meta.name}`}
          title="拖动排序"
        >
          <GripVertical size={14} />
        </button>
        <button
          type="button"
          onClick={onSelect}
          className="flex-1 flex items-center gap-2 py-2 pr-3 text-left min-w-0"
        >
          <span
            className={`w-5 h-5 flex items-center justify-center flex-shrink-0 ${
              enabled
                ? "text-blue-600 dark:text-blue-400"
                : "text-gray-400 dark:text-gray-500"
            }`}
          >
            <Icon size={18} />
          </span>
          <span
            className={`flex-1 min-w-0 truncate text-sm ${
              enabled
                ? isActive
                  ? "text-blue-700 dark:text-blue-400 font-medium"
                  : "text-gray-900 dark:text-gray-100"
                : "text-gray-500 dark:text-gray-400"
            }`}
          >
            {plugin.meta.name}
          </span>
          {errorCount > 0 && (
            <span
              className="inline-flex items-center gap-1 flex-shrink-0"
              title={`${errorCount} 条错误日志`}
              aria-label={`${errorCount} 条错误日志`}
              role="img"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              <span className="text-[10px] leading-none tabular-nums text-red-500 dark:text-red-400">
                {errorCount}
              </span>
            </span>
          )}
          {enabled && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0"
              title="已启用"
              aria-label="已启用"
              role="img"
            />
          )}
        </button>
      </div>
    </li>
  );
}

interface PluginDetailProps {
  plugin: NyaaPlugin;
  state: PluginState;
  pending: boolean;
  onToggleEnabled: (next: boolean) => void;
}

function PluginDetail({
  plugin,
  state,
  pending,
  onToggleEnabled,
}: PluginDetailProps) {
  const { meta } = plugin;
  const Icon = resolvePluginIcon(meta.icon);
  const SettingsPanel = plugin.SettingsPanel;

  // 传给设置面板的 callBackend：插件声明过该能力时直接转发到框架的
  // `callPluginBackend`；未声明的能力在框架侧查表失败即抛（安全红线 §7.3）。
  // 这里的作用只是让失败更早、错误文案更贴近调用点。
  const callBackend = useCallback(
    <T = unknown,>(capability: string, payload?: unknown): Promise<T> => {
      if (!getPluginBackendDeclaration(meta.id, capability)) {
        return Promise.reject(
          new Error(
            `[plugins] 插件 "${meta.id}" 未声明能力 "${capability}"，调用被拒绝`,
          ),
        );
      }
      return callPluginBackend<T>(meta.id, capability, payload);
    },
    [meta.id],
  );

  const updateConfig = useCallback(
    (patch: Record<string, unknown>) => {
      updatePluginConfig(meta.id, patch);
    },
    [meta.id],
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 pb-4 border-b border-gray-100 dark:border-white/5">
        <span className="w-10 h-10 flex items-center justify-center bg-gray-100 dark:bg-white/5 rounded-xl flex-shrink-0 text-gray-500 dark:text-gray-400">
          <Icon size={22} />
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold truncate text-gray-900 dark:text-gray-100">
            {meta.name}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
            v{meta.version} · {meta.id}
            {meta.author ? ` · ${meta.author}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {pending && (
            <Loader2
              size={14}
              className="animate-spin text-gray-400"
              aria-label="正在保存"
            />
          )}
          <ToggleSwitch
            checked={state.enabled}
            disabled={pending}
            onChange={onToggleEnabled}
            label={state.enabled ? "已启用" : "已禁用"}
          />
        </div>
      </div>

      <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap break-words">
        {meta.description?.trim() || NO_DESCRIPTION_TEXT}
      </p>

      {/* 用户 2026-09-15 要求：详情页**不显示** `backend[]` 的后端声明行
          （原先渲染成 `POST /api/ext-host/plugins/quote-tts/speech — 受控 Edge-TTS 代理：…`）。
          该信息对使用者无意义、且长串会占满整行；需要排障时看插件自己的 README 或
          `plugins/<id>/plugin.tsx` 的 `backend[]` 即可。`getPluginBackendDeclaration`
          仍在 `callBackend` 里做"未声明即拒"的运行时校验（安全红线 §7.3），只是不再展示。 */}

      <div>
        {SettingsPanel ? (
          // key = pluginId：切换插件时重挂载，让面板内部草稿状态按插件重新播种；
          // 开关 enabled 不会改变 key，因此正在编辑的草稿不会被重置。
          <SettingsPanel
            key={meta.id}
            pluginId={meta.id}
            config={state.config}
            updateConfig={updateConfig}
            callBackend={callBackend}
          />
        ) : (
          <div className="rounded-xl border border-dashed border-gray-300 dark:border-white/15 p-6 text-center text-sm text-gray-500 dark:text-gray-400">
            {NO_SETTINGS_TEXT}
          </div>
        )}
      </div>

      {/* P6 F3：运行日志 —— 插件侧与框架侧（setup / 事件处理器 / 后端调用 …）的报错都汇到
          这里，普通用户无需开 DevTools 就能看到"哪个插件出错了"。 */}
      <PluginRunLog pluginId={meta.id} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// P6 F3：插件运行日志区
// ─────────────────────────────────────────────────────────────────────────────

/** 剪贴板写入失败的兜底文案停留时长。 */
const COPY_FEEDBACK_MS = 2000;

/** 单条日志里的"首行消息"（完整消息在展开区/复制内容里）。 */
function firstLineOf(message: string): string {
  const line = message.split("\n")[0] ?? "";
  return line.trim() || "(空消息)";
}

function logTimeOf(at: number): string {
  try {
    return new Date(at).toLocaleTimeString();
  } catch {
    return "";
  }
}

/** 复制到剪贴板的文本（时间 + 级别 + 作用域 + 完整消息 + 栈），供贴进 issue / 日志。 */
function formatLogRecordForCopy(record: PluginLogRecord): string {
  const head =
    `[${new Date(record.at).toLocaleString()}] ` +
    `${record.level === "error" ? "错误" : "警告"} ` +
    `${record.scope} — ${record.message}` +
    (record.count > 1 ? `（×${record.count}）` : "");
  return record.stack ? `${head}\n${record.stack}` : head;
}

/**
 * 写剪贴板：优先 async Clipboard API，失败/不可用（非安全上下文、旧浏览器）时退回
 * 临时 `<textarea>` + `execCommand("copy")`。返回是否成功，供按钮给出"已复制/复制失败"。
 */
async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 落到下面的兜底 */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.left = "0";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/**
 * 插件的「运行日志」区（P6 F3）。
 *
 * 订阅 `src/plugins/pluginLog` 的 store（`useSyncExternalStore`，与运行时快照同一范式），
 * 展示该插件的最近 ≤20 条 `error` / `warn` 记录：时间 + 级别 + 作用域 + 首行消息，
 * 有栈的可展开看完整 stack；另有「复制」「清空」。
 *
 * ⚠️ 版式约束（详情面板曾出现横向滚动条）：本区沿用外层 `min-w-0` / `break-all` /
 * `whitespace-pre-wrap`，长栈与长作用域只在自己内部换行或滚动，不撑宽弹窗。
 */
function PluginRunLog({ pluginId }: { pluginId: string }) {
  // getSnapshot 必须返回**缓存引用**：pluginLog 内部保证没变更时同一引用，
  // 因此这里用内联箭头即可（不会触发 "getSnapshot should be cached" 警告）。
  const records = useSyncExternalStore(subscribePluginErrors, () => getPluginErrors(pluginId));
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const errorCount = records.reduce((n, record) => (record.level === "error" ? n + 1 : n), 0);

  const handleCopy = useCallback(async () => {
    const ok = await copyTextToClipboard(records.map(formatLogRecordForCopy).join("\n\n"));
    setCopyState(ok ? "copied" : "failed");
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopyState("idle"), COPY_FEEDBACK_MS);
  }, [records]);

  const handleClear = useCallback(() => {
    clearPluginErrors(pluginId);
    setExpandedId(null);
  }, [pluginId]);

  return (
    <div className="space-y-2 min-w-0">
      <div className="flex items-center justify-between gap-2 min-h-[1.25rem]">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          运行日志
          {errorCount > 0 && (
            <span className="normal-case text-red-500 dark:text-red-400">{errorCount} 条错误</span>
          )}
        </span>
        {records.length > 0 && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="px-2 py-1 text-[11px] font-medium rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
            >
              {copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败" : "复制"}
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="px-2 py-1 text-[11px] font-medium rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
            >
              清空
            </button>
          </div>
        )}
      </div>

      {records.length === 0 ? (
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          暂无运行日志。插件报错（含 setup、事件处理器、后端调用）会记录在这里，保留最近 20 条。
        </p>
      ) : (
        <ul className="space-y-2 list-none min-w-0">
          {records.map((record) => (
            <li
              key={record.id}
              className="rounded-xl border border-gray-200 dark:border-white/10 p-2.5 min-w-0"
            >
              <div className="flex items-start gap-2 min-w-0">
                <span
                  className={`mt-0.5 flex-shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                    record.level === "error"
                      ? "bg-red-500/10 text-red-600 dark:text-red-400"
                      : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  }`}
                >
                  {record.level === "error" ? "错误" : "警告"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                    <span className="tabular-nums">{logTimeOf(record.at)}</span>
                    <span className="font-mono break-all">{record.scope}</span>
                    {record.count > 1 && (
                      <span className="tabular-nums" title="连续重复次数">
                        ×{record.count}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-gray-700 dark:text-gray-300 break-words">
                    {firstLineOf(record.message)}
                  </p>
                  {record.stack && (
                    <>
                      <button
                        type="button"
                        onClick={() => setExpandedId(expandedId === record.id ? null : record.id)}
                        className="mt-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {expandedId === record.id ? "收起堆栈" : "展开堆栈"}
                      </button>
                      {expandedId === record.id && (
                        <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-gray-100/70 dark:bg-black/30 p-2 text-[10px] leading-relaxed font-mono whitespace-pre-wrap break-all text-gray-600 dark:text-gray-400">
                          {record.stack}
                        </pre>
                      )}
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default ExtensionsModal;
