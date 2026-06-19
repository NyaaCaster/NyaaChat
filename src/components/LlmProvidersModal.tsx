import { useEffect, useRef, useState } from "react";
import {
  closestCenter,
  DndContext,
  DragEndEvent,
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
  ArrowLeft,
  Check,
  Database,
  GripVertical,
  Heart,
  ListChecks,
  Loader2,
  LogOut,
  MessageSquare,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { ApiFormat, AppState, LlmProvider, ModelCapability, ModelEntry } from "../types";
import { BaseModal } from "./BaseModal";
import { ConfirmDialog } from "./ConfirmDialog";
import { ApiKeyInput } from "./ApiKeyInput";
import { Field, FieldHint, ToggleSwitch, DeleteModelButton } from "./SettingsFormBits";
import { LlmProviderIcon } from "./icons/providerIcons";
import { CAPABILITY_META as SHARED_CAPABILITY_META } from "./icons/capabilityMeta";
import { ManageModelsModal } from "./ManageModelsModal";
import { newId } from "../lib/id";
import { normalizeBaseUrl } from "../lib/api";
import { QINY_ENDPOINTS, resolveQinyEndpoint, type QinyEndpoint } from "../lib/providers";
import { probeModel } from "../lib/modelHealth";

interface LlmProvidersModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppState;
  onSave: (settings: AppState) => void;
}

/**
 * Provider list + per-provider API settings, CherryStudio/ChatBox style.
 *
 * Phase 6 set up the layout (drag-sortable list, mobile list↔detail nav,
 * bottom-fixed add button). Phase 7 fills the right column with the actual
 * fields:
 *   - header: icon + name (editable for custom) + enabled toggle + delete
 *     button (custom only)
 *   - API 兼容模式 (custom only): OpenAI / Anthropic
 *   - API 地址 (custom + ollama only): with onBlur normalization
 *   - API Key (always)
 *   - 模型列表 placeholder (phase 8 implements 管理模型, phase 9 健康测试)
 */
export function LlmProvidersModal({
  isOpen,
  onClose,
  settings,
  onSave,
}: LlmProvidersModalProps) {
  const providers = settings.llmProviders;

  const [selectedId, setSelectedId] = useState<string>(providers[0]?.id ?? "");
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [manageModelsForId, setManageModelsForId] = useState<string | null>(null);

  useEffect(() => {
    if (!providers.find((p) => p.id === selectedId) && providers[0]) {
      setSelectedId(providers[0].id);
    }
  }, [providers, selectedId]);

  useEffect(() => {
    if (isOpen) setMobileView("list");
  }, [isOpen]);

  const selected = providers.find((p) => p.id === selectedId);
  const pendingDelete = providers.find((p) => p.id === pendingDeleteId) ?? null;
  const manageModelsFor =
    providers.find((p) => p.id === manageModelsForId) ?? null;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const updateProviders = (next: LlmProvider[]) => {
    onSave({ ...settings, llmProviders: next });
  };

  const updateProvider = (next: LlmProvider) => {
    updateProviders(providers.map((p) => (p.id === next.id ? next : p)));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = providers.findIndex((p) => p.id === active.id);
    const newIdx = providers.findIndex((p) => p.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    updateProviders(arrayMove(providers, oldIdx, newIdx));
  };

  const handleAddProvider = () => {
    const next: LlmProvider = {
      id: newId(),
      kind: "custom",
      name: "自定义供应商",
      enabled: false,
      apiKey: "",
      baseUrl: "",
      apiFormat: "openai",
      models: [],
    };
    updateProviders([next, ...providers]);
    setSelectedId(next.id);
    setMobileView("detail");
  };

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setMobileView("detail");
  };

  const handleConfirmDelete = () => {
    if (!pendingDelete) return;
    // Built-in providers can't be deleted; the UI never offers it, but the
    // guard keeps state honest if some other code path ever asked.
    if (pendingDelete.kind !== "custom") {
      setPendingDeleteId(null);
      return;
    }
    const next = providers.filter((p) => p.id !== pendingDelete.id);
    updateProviders(next);
    // If we just deleted the active provider, fall back to the first survivor.
    if (selectedId === pendingDelete.id) {
      setSelectedId(next[0]?.id ?? "");
      setMobileView("list");
    }
    setPendingDeleteId(null);
  };

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onClose={onClose}
        title="对话模型供应商"
        titleIcon={
          <MessageSquare size={16} className="text-blue-600 dark:text-blue-400" />
        }
        maxWidth="max-w-5xl"
      >
        <div className="pv-layout h-[600px] max-h-[70vh]">
          {/* Provider list pane */}
          <div
            className={`pv-pane-list ${
              mobileView === "detail" ? "pv-pane-hidden" : ""
            } flex-col sm:border-r border-gray-200 dark:border-white/10 bg-gray-50/50 dark:bg-black/20 min-h-0`}
          >
            <div className="flex-1 overflow-y-auto p-2 min-h-0">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
                modifiers={[restrictToVerticalAxis, restrictToParentElement]}
              >
                <SortableContext
                  items={providers.map((p) => p.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="space-y-1 list-none">
                    {providers.map((p) => (
                      <SortableProviderRow
                        key={p.id}
                        provider={p}
                        isActive={p.id === selectedId}
                        onClick={() => handleSelect(p.id)}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            </div>
            <div className="flex-shrink-0 p-2 border-t border-gray-200 dark:border-white/10">
              <button
                type="button"
                onClick={handleAddProvider}
                className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl border border-dashed border-gray-300 dark:border-white/20 text-gray-600 dark:text-gray-400 hover:border-blue-400 dark:hover:border-blue-400/60 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-all text-sm font-medium"
              >
                <Plus size={16} />
                添加供应商
              </button>
            </div>
          </div>

          {/* Detail pane */}
          <div
            className={`pv-pane-detail ${
              mobileView === "list" ? "pv-pane-hidden" : ""
            } flex-col min-h-0`}
          >
            {selected ? (
              <>
                <div className="pv-only-mobile items-center gap-2 p-3 border-b border-gray-200 dark:border-white/10 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setMobileView("list")}
                    className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
                    aria-label="返回供应商列表"
                  >
                    <ArrowLeft size={18} />
                  </button>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                    返回列表
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto p-6 min-h-0">
                  <ProviderDetail
                    key={selected.id}
                    provider={selected}
                    onUpdate={updateProvider}
                    onOpenManage={() => setManageModelsForId(selected.id)}
                    onRequestDelete={
                      selected.kind === "custom"
                        ? () => setPendingDeleteId(selected.id)
                        : undefined
                    }
                  />
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">
                请选择左侧的供应商
              </div>
            )}
          </div>
        </div>
      </BaseModal>
      <ConfirmDialog
        isOpen={!!pendingDelete}
        title="删除供应商"
        destructive
        confirmText="删除"
        message={
          pendingDelete ? (
            <>
              将永久删除自定义供应商
              <span className="font-semibold text-gray-900 dark:text-gray-100 mx-1">
                {pendingDelete.name}
              </span>
              ,其下保存的 API Key 与模型列表也会一并清除。该操作不可撤销。
            </>
          ) : (
            ""
          )
        }
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDeleteId(null)}
      />
      {manageModelsFor && (
        <ManageModelsModal
          isOpen={!!manageModelsFor}
          onClose={() => setManageModelsForId(null)}
          provider={manageModelsFor}
          onUpdate={updateProvider}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Provider list row (drag-sortable)
// ---------------------------------------------------------------------------

interface SortableProviderRowProps {
  provider: LlmProvider;
  isActive: boolean;
  onClick: () => void;
}

function SortableProviderRow({
  provider,
  isActive,
  onClick,
}: SortableProviderRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: provider.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : "auto",
  };

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
          aria-label={`拖动 ${provider.name}`}
        >
          <GripVertical size={14} />
        </button>
        <button
          type="button"
          onClick={onClick}
          className="flex-1 flex items-center gap-2 py-2 pr-3 text-left min-w-0"
        >
          <span className="w-5 h-5 flex items-center justify-center flex-shrink-0">
            <LlmProviderIcon kind={provider.kind} size={18} />
          </span>
          <span
            className={`flex-1 truncate text-sm ${
              isActive
                ? "text-blue-700 dark:text-blue-400 font-medium"
                : "text-gray-900 dark:text-gray-100"
            }`}
          >
            {provider.name}
          </span>
          {provider.enabled && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0"
              title="已启用"
            />
          )}
        </button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Provider detail (right column)
// ---------------------------------------------------------------------------

interface ProviderDetailProps {
  provider: LlmProvider;
  onUpdate: (next: LlmProvider) => void;
  onOpenManage: () => void;
  /** Provided only for kind === "custom". Built-in presets can't be removed. */
  onRequestDelete?: () => void;
}

function ProviderDetail({
  provider,
  onUpdate,
  onOpenManage,
  onRequestDelete,
}: ProviderDetailProps) {
  const showCompatMode = provider.kind === "custom";
  const showBaseUrl = provider.kind === "custom" || provider.kind === "ollama";
  const isNameEditable = provider.kind === "custom";

  // Local edit state for text fields. Committed back to AppState onBlur so
  // we don't pay a localStorage write per keystroke. The `key={provider.id}`
  // on this component (set in the parent) re-mounts on selection change, so
  // these locals naturally re-seed from the provider prop without an effect.
  const [draftName, setDraftName] = useState(provider.name);
  const [draftBaseUrl, setDraftBaseUrl] = useState(provider.baseUrl);
  const [draftApiKey, setDraftApiKey] = useState(provider.apiKey);

  const commitIfChanged = (patch: Partial<LlmProvider>) => {
    const candidate = { ...provider, ...patch };
    const changed = (Object.keys(patch) as (keyof LlmProvider)[]).some(
      (k) => candidate[k] !== provider[k],
    );
    if (changed) onUpdate(candidate);
  };

  const handleNameBlur = () => {
    const trimmed = draftName.trim();
    if (!trimmed) {
      // Disallow empty rename — revert to the previous value.
      setDraftName(provider.name);
      return;
    }
    commitIfChanged({ name: trimmed });
  };

  const handleBaseUrlBlur = () => {
    const normalized = normalizeBaseUrl(draftBaseUrl);
    setDraftBaseUrl(normalized);
    commitIfChanged({ baseUrl: normalized });
  };

  const handleApiKeyBlur = () => {
    commitIfChanged({ apiKey: draftApiKey });
  };

  const handleApiFormatChange = (format: ApiFormat) => {
    onUpdate({ ...provider, apiFormat: format });
  };

  // QinyAPI access-point switch: rewrites baseUrl to the chosen host's `/v1`
  // base (normalizeBaseUrl-friendly), preserving the saved API Key / models.
  const handleQinyEndpointSelect = (ep: QinyEndpoint) => {
    if (provider.baseUrl === ep.llmBaseUrl) return;
    onUpdate({ ...provider, baseUrl: ep.llmBaseUrl });
  };

  const handleEnabledToggle = (next: boolean) => {
    onUpdate({ ...provider, enabled: next });
  };

  const [isHealthTesting, setIsHealthTesting] = useState(false);
  const [healthProgress, setHealthProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  // Set of model ids currently in flight. Drives per-row spinners
  // independently of completion order so concurrent probes all show
  // their loader at once instead of lighting up sequentially.
  const [probingIds, setProbingIds] = useState<Set<string>>(new Set());
  // Stash an AbortController so unmount/select-other-provider cancels the
  // in-flight probe loop instead of letting it keep mutating state.
  const [healthAbort, setHealthAbort] = useState<AbortController | null>(null);

  // Mirror the latest provider into a ref so the async health-test loop can
  // commit updates against the freshest field values — without this, an
  // edit the user makes mid-test (e.g. adding a model via 管理模型) would
  // be clobbered by the stale closure.
  const providerRef = useRef(provider);
  useEffect(() => {
    providerRef.current = provider;
  }, [provider]);

  // Cancel any in-flight health test if user switches away from this
  // provider. The parent re-keys this component on selection change so the
  // unmount cleanup fires reliably.
  useEffect(() => {
    return () => {
      healthAbort?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Run health-test concurrently across all enabled models. Each probe
  // commits its result to AppState as it lands, so partial progress
  // survives a mid-run cancel.
  //
  // Concurrency invariant: providerRef updates only after React
  // re-renders, so two probes finishing back-to-back would both read
  // the same stale ref and the second commit would clobber the first.
  // We keep a local Map of completed probe results and overlay it
  // onto the freshest provider state on every commit — this preserves
  // both other concurrent probes' results AND any unrelated field
  // edits the user made mid-run.
  const handleHealthTest = async () => {
    if (isHealthTesting || provider.models.length === 0) return;
    const ac = new AbortController();
    setHealthAbort(ac);
    setIsHealthTesting(true);
    setHealthProgress({ current: 0, total: provider.models.length });

    const queue = [...provider.models];
    const probedResults = new Map<string, ModelEntry>();
    let done = 0;

    // Mark every model as in-flight up front so all rows start
    // spinning together — visually communicates "concurrent" instead
    // of "queued".
    setProbingIds(new Set(queue.map((m) => m.id)));

    await Promise.all(
      queue.map(async (entry) => {
        if (ac.signal.aborted) return;
        try {
          const updated = await probeModel(provider, entry, ac.signal);
          if (ac.signal.aborted) return;
          probedResults.set(entry.id, updated);
          const latest = providerRef.current;
          onUpdate({
            ...latest,
            models: latest.models.map((m) => probedResults.get(m.id) ?? m),
          });
          done += 1;
          setHealthProgress({ current: done, total: queue.length });
        } finally {
          // Clear this row's spinner the moment its probe lands,
          // regardless of success/failure, so each row independently
          // transitions from loader → result.
          setProbingIds((prev) => {
            if (!prev.has(entry.id)) return prev;
            const next = new Set(prev);
            next.delete(entry.id);
            return next;
          });
        }
      }),
    );

    setIsHealthTesting(false);
    setHealthProgress(null);
    setHealthAbort(null);
    setProbingIds(new Set());
  };

  const handleHealthCancel = () => {
    healthAbort?.abort();
  };

  // Removes a saved model directly from provider.models — the escape hatch
  // for orphaned entries the upstream API no longer lists (管理模型 only
  // shows live models, so a delisted SKU can't be toggled off there).
  const handleDeleteModel = (modelId: string) => {
    const next: LlmProvider = {
      ...provider,
      models: provider.models.filter((m) => m.id !== modelId),
    };
    if (next.lastUsedModel === modelId) {
      next.lastUsedModel = undefined;
    }
    onUpdate(next);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3 pb-4 border-b border-gray-100 dark:border-white/5">
        <span className="w-10 h-10 flex items-center justify-center bg-gray-100 dark:bg-white/5 rounded-xl flex-shrink-0">
          <LlmProviderIcon kind={provider.kind} size={22} />
        </span>
        <div className="flex-1 min-w-0">
          {isNameEditable ? (
            <input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={handleNameBlur}
              className="w-full text-lg font-semibold bg-transparent border-b border-transparent hover:border-gray-200 dark:hover:border-white/10 focus:border-blue-500 focus:outline-none text-gray-900 dark:text-gray-100 transition-colors"
            />
          ) : (
            <h3 className="text-lg font-semibold truncate text-gray-900 dark:text-gray-100">
              {provider.name}
            </h3>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {provider.kind === "custom" ? "自定义端点" : provider.kind}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <ToggleSwitch
            checked={provider.enabled}
            onChange={handleEnabledToggle}
            label={provider.enabled ? "已启用" : "已禁用"}
          />
          {onRequestDelete && (
            <button
              type="button"
              onClick={onRequestDelete}
              className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
              aria-label="删除供应商"
              title="删除该自定义供应商"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>

      {/* API 兼容模式 */}
      {showCompatMode && (
        <Field label="API 兼容模式">
          <div className="flex flex-wrap gap-2">
            {(
              [
                { value: "openai", label: "OpenAI" },
                { value: "anthropic", label: "Anthropic" },
              ] as const
            ).map((opt) => {
              const active = provider.apiFormat === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleApiFormatChange(opt.value)}
                  className={`px-4 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                    active
                      ? "border-blue-500 bg-blue-500/10 dark:bg-blue-500/15 ring-1 ring-blue-500 text-blue-600 dark:text-blue-400"
                      : "border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#1A1A1A] text-gray-900 dark:text-gray-100 hover:border-gray-300 dark:hover:border-white/20"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <FieldHint>
            OpenAI 模式适用于 OpenAI 及大多数兼容代理;Anthropic 模式直连 Claude
            官方 API。
          </FieldHint>
        </Field>
      )}

      {/* API 地址 */}
      {showBaseUrl && (
        <Field label="API 地址">
          <input
            type="text"
            value={draftBaseUrl}
            onChange={(e) => setDraftBaseUrl(e.target.value)}
            onBlur={handleBaseUrlBlur}
            placeholder={
              provider.kind === "ollama"
                ? "http://localhost:11434"
                : provider.apiFormat === "anthropic"
                  ? "https://api.anthropic.com/v1"
                  : "https://api.openai.com/v1"
            }
            className="w-full px-4 py-3 border border-gray-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50 dark:bg-[#1A1A1A] text-gray-900 dark:text-gray-100 outline-none transition-all placeholder:text-gray-400 dark:placeholder:text-gray-600 font-mono text-sm"
          />
          <FieldHint>
            支持粘贴完整的 chat/completions 或 messages URL,失焦后自动剥离已知
            后缀;空路径会自动补 /v1 前缀。
          </FieldHint>
        </Field>
      )}

      {/* QinyAPI 接入点 */}
      {provider.kind === "qiny" && (
        <Field label="QingAPI 接入点">
          <div className="flex flex-wrap gap-2">
            {QINY_ENDPOINTS.map((ep) => {
              const active = resolveQinyEndpoint(provider.baseUrl).id === ep.id;
              return (
                <button
                  key={ep.id}
                  type="button"
                  onClick={() => handleQinyEndpointSelect(ep)}
                  className={`px-4 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                    active
                      ? "border-blue-500 bg-blue-500/10 dark:bg-blue-500/15 ring-1 ring-blue-500 text-blue-600 dark:text-blue-400"
                      : "border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#1A1A1A] text-gray-900 dark:text-gray-100 hover:border-gray-300 dark:hover:border-white/20"
                  }`}
                >
                  {ep.label}
                </button>
              );
            })}
          </div>
          <FieldHint>
            国内使用 .com 节点，海外或翻墙后使用.icu 节点
          </FieldHint>
        </Field>
      )}

      {/* API Key */}
      <Field
        label="API Key"
        actionSlot={
          provider.kind === "qiny" && (
            <a
              href={resolveQinyEndpoint(provider.baseUrl).apiKeyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline transition-colors"
            >
              获取 API Key
            </a>
          )
        }
      >
        <ApiKeyInput
          value={draftApiKey}
          onChange={setDraftApiKey}
          onBlur={handleApiKeyBlur}
          placeholder="sk-..."
        />
      </Field>

      {/* 模型列表 */}
      <Field label="模型列表">
        <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#1A1A1A] overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-white/10 bg-white/50 dark:bg-black/20">
            <button
              type="button"
              onClick={onOpenManage}
              disabled={!provider.baseUrl || (provider.kind !== "ollama" && !provider.apiKey)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-white/20 hover:bg-gray-50 dark:hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-gray-200 dark:disabled:hover:border-white/10 transition-all"
              title={
                !provider.baseUrl
                  ? "请先填写 API 地址"
                  : provider.kind !== "ollama" && !provider.apiKey
                    ? "请先填写 API Key"
                    : "拉取并选择启用的模型"
              }
            >
              <ListChecks size={14} />
              管理模型
            </button>
            {isHealthTesting ? (
              <button
                type="button"
                onClick={handleHealthCancel}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-red-300 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 transition-all"
                title="取消健康测试"
              >
                <X size={14} />
                取消测试 ({healthProgress?.current ?? 0}/
                {healthProgress?.total ?? provider.models.length})
              </button>
            ) : (
              <button
                type="button"
                onClick={handleHealthTest}
                disabled={
                  provider.models.length === 0 ||
                  !provider.baseUrl ||
                  (provider.kind !== "ollama" && !provider.apiKey)
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-white/20 hover:bg-gray-50 dark:hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-gray-200 dark:disabled:hover:border-white/10 transition-all"
                title={
                  provider.models.length === 0
                    ? "先添加至少一个模型"
                    : provider.kind !== "ollama" && !provider.apiKey
                      ? "请先填写 API Key"
                      : "对所有已启用模型运行最低 token 健康检测"
                }
              >
                <Heart size={14} />
                健康测试
              </button>
            )}
            <span className="ml-auto text-[11px] text-gray-400 dark:text-gray-500">
              共 {provider.models.length} 个模型
            </span>
          </div>
          {provider.models.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              暂无已启用的模型
              <br />
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {provider.kind === "ollama" || provider.apiKey
                  ? "点击「管理模型」从清单中启用"
                  : "请先填写 API Key,再点击「管理模型」"}
              </span>
            </div>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-white/5">
              {provider.models.map((m) => (
                <ModelRow
                  key={m.id}
                  entry={m}
                  isProbing={probingIds.has(m.id)}
                  onDelete={() => handleDeleteModel(m.id)}
                  deleteDisabled={isHealthTesting}
                />
              ))}
            </ul>
          )}
        </div>
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ModelRow({
  entry,
  isProbing,
  onDelete,
  deleteDisabled,
}: {
  entry: ModelEntry;
  isProbing: boolean;
  onDelete: () => void;
  deleteDisabled: boolean;
}) {
  return (
    <li className="flex items-center gap-2 px-4 py-2.5 text-sm">
      <DeleteModelButton
        onConfirm={onDelete}
        disabled={deleteDisabled}
        disabledReason="健康测试进行中，暂不可删除"
      />
      <span className="font-mono text-gray-700 dark:text-gray-300 truncate min-w-0 flex-shrink-[2]">
        {entry.id}
      </span>
      <CapabilityIcons capabilities={entry.capabilities} />
      <MetricChip
        icon={<Database size={11} />}
        value={formatTokens(entry.contextWindow)}
        title="上下文窗口长度"
      />
      <MetricChip
        icon={<LogOut size={11} />}
        value={formatTokens(entry.maxOutput)}
        title="最大输出长度"
      />
      <span className="ml-auto inline-flex items-center gap-1.5 flex-shrink-0">
        {isProbing ? (
          <Loader2 size={12} className="animate-spin text-blue-500" />
        ) : entry.health ? (
          <HealthBadge health={entry.health} />
        ) : (
          <span className="text-[11px] text-gray-400 dark:text-gray-500">
            未测试
          </span>
        )}
      </span>
    </li>
  );
}

const CAPABILITY_META = SHARED_CAPABILITY_META;

function CapabilityIcons({
  capabilities,
}: {
  capabilities: ModelCapability[] | undefined;
}) {
  // Tap an icon to show its label. PC users get the same info via the
  // native `title` hover tooltip; this state-driven popover is what
  // mobile (no hover) users see when they tap.
  const [activeCap, setActiveCap] = useState<ModelCapability | null>(null);

  useEffect(() => {
    if (!activeCap) return;
    const t = setTimeout(() => setActiveCap(null), 2500);
    return () => clearTimeout(t);
  }, [activeCap]);

  if (!capabilities || capabilities.length === 0) {
    return null;
  }
  return (
    <span className="inline-flex items-center gap-0.5 flex-shrink-0">
      {capabilities.map((cap) => {
        const meta = CAPABILITY_META[cap];
        const Icon = meta.Icon;
        const active = activeCap === cap;
        return (
          <span key={cap} className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActiveCap(active ? null : cap);
              }}
              className={`inline-flex items-center justify-center w-5 h-5 rounded ${meta.color} hover:bg-gray-100 dark:hover:bg-white/5 transition-colors`}
              title={meta.label}
              aria-label={meta.label}
            >
              <Icon size={12} />
            </button>
            {active && (
              <span
                className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-[10px] font-medium whitespace-nowrap pointer-events-none shadow-elevation-2 z-10"
                role="tooltip"
              >
                {meta.label}
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

function MetricChip({
  icon,
  value,
  title,
}: {
  icon: React.ReactNode;
  value: string;
  title: string;
}) {
  // Same tap-to-reveal pattern as CapabilityIcons: PC users get the native
  // hover tooltip via the title attribute; mobile users tap to see the
  // label. Auto-clears after 2.5s.
  const [showLabel, setShowLabel] = useState(false);

  useEffect(() => {
    if (!showLabel) return;
    const t = setTimeout(() => setShowLabel(false), 2500);
    return () => clearTimeout(t);
  }, [showLabel]);

  return (
    <span className="relative flex-shrink-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setShowLabel((v) => !v);
        }}
        className="inline-flex items-center gap-0.5 text-[11px] text-gray-500 dark:text-gray-400 tabular-nums hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        title={title}
        aria-label={title}
      >
        {icon}
        {value}
      </button>
      {showLabel && (
        <span
          className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-[10px] font-medium whitespace-nowrap pointer-events-none shadow-elevation-2 z-10"
          role="tooltip"
        >
          {title}
        </span>
      )}
    </span>
  );
}

function HealthBadge({
  health,
}: {
  health: NonNullable<ModelEntry["health"]>;
}) {
  const latencyText = formatLatency(health.latencyMs);
  if (health.ok) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] text-green-600 dark:text-green-400 tabular-nums"
        title={`通过 · ${latencyText}`}
      >
        <span className="tabular-nums">{latencyText}</span>
        <Check size={13} strokeWidth={3} />
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400 tabular-nums"
      title={health.error || "失败"}
    >
      <span className="tabular-nums">{latencyText}</span>
      <X size={13} strokeWidth={3} />
    </span>
  );
}

function formatTokens(n: number | undefined): string {
  if (n == null) return "--";
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return Number.isInteger(m) ? `${m}M` : `${m.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return Number.isInteger(k) ? `${k}K` : `${k.toFixed(1)}K`;
  }
  return String(n);
}

function formatLatency(ms: number | undefined): string {
  if (ms == null) return "--";
  return `${(ms / 1000).toFixed(1)}s`;
}
