import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  ListChecks,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import { AppState, ComfyImageSize, ImageProvider, ImageSize, ModelEntry } from "../types";
import { BaseModal } from "./BaseModal";
import { ApiKeyInput } from "./ApiKeyInput";
import { Field, FieldHint, ToggleSwitch, DeleteModelButton } from "./SettingsFormBits";
import { ImageProviderIcon } from "./icons/providerIcons";
import { ManageImageModelsModal } from "./ManageImageModelsModal";
import { ConfirmDialog } from "./ConfirmDialog";
import { ImageProviderTypeModal, type AddableImageProviderKind } from "./ImageProviderTypeModal";
import { ComfyWorkflowInfoModal } from "./ComfyWorkflowInfoModal";
import {
  COMFY_WORKFLOWS,
  COMFYUI_FIXED_DESC,
  COMFYUI_FIXED_NAME,
  comfyWorkflowById,
  defaultComfyFields,
  QINY_ENDPOINTS,
  resolveQinyEndpoint,
  type QinyEndpoint,
} from "../lib/providers";
import { newId } from "../lib/id";
import {
  checkComfyHealth,
  generateComfyImage,
  loadArtList,
  type ArtStyleOption,
  type ComfyProgress,
} from "../lib/comfyuiApi";

interface ImageProvidersModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppState;
  onSave: (settings: AppState) => void;
}

const COMFY_SIZES: { value: ComfyImageSize; label: string }[] = [
  { value: "1024x1024", label: "1024×1024" },
  { value: "1024x1536", label: "1024×1536" },
  { value: "1536x1024", label: "1536×1024" },
];

function isCustomKind(kind: ImageProvider["kind"]): boolean {
  return kind === "openai-custom" || kind === "comfyui-custom";
}
function isComfyKind(kind: ImageProvider["kind"]): boolean {
  return kind === "comfyui-fixed" || kind === "comfyui-custom";
}
function isManageableKind(kind: ImageProvider["kind"]): boolean {
  // OpenAI-compatible kinds expose /v1/models we can pull from.
  return kind === "qiny" || kind === "openai-custom";
}

/**
 * Image-side provider settings. Mirrors LlmProvidersModal's layout (list +
 * per-provider detail), now with two provider families:
 *   - OpenAI-compatible (built-in QinyAPI + custom openai-custom)
 *   - ComfyUI graph (built-in fixed NyaaComfyUI + custom comfyui-custom)
 * Custom providers are added via the "添加供应商" → 供应商类型 picker and are
 * deletable; the two built-ins are not.
 */
export function ImageProvidersModal({
  isOpen,
  onClose,
  settings,
  onSave,
}: ImageProvidersModalProps) {
  const providers = settings.imageProviders;

  const [selectedId, setSelectedId] = useState<string>(providers[0]?.id ?? "");
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [manageModelsForId, setManageModelsForId] = useState<string | null>(null);
  const [addTypeOpen, setAddTypeOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [workflowInfoOpen, setWorkflowInfoOpen] = useState(false);

  useEffect(() => {
    if (!providers.find((p) => p.id === selectedId) && providers[0]) {
      setSelectedId(providers[0].id);
    }
  }, [providers, selectedId]);

  useEffect(() => {
    if (isOpen) setMobileView("list");
  }, [isOpen]);

  const selected = providers.find((p) => p.id === selectedId);
  const manageModelsFor = providers.find((p) => p.id === manageModelsForId) ?? null;
  const pendingDelete = providers.find((p) => p.id === pendingDeleteId) ?? null;

  const updateProviders = (next: ImageProvider[]) => {
    onSave({ ...settings, imageProviders: next });
  };

  const updateProvider = (next: ImageProvider) => {
    updateProviders(providers.map((p) => (p.id === next.id ? next : p)));
  };

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setMobileView("detail");
  };

  const handlePickType = (kind: AddableImageProviderKind) => {
    const id = newId();
    const next: ImageProvider =
      kind === "openai-custom"
        ? {
            id,
            kind,
            name: "自定义生图 API",
            enabled: false,
            apiKey: "",
            baseUrl: "",
            models: [],
            size: "default",
          }
        : {
            id,
            kind: "comfyui-custom",
            name: "自定义 ComfyUI",
            enabled: false,
            apiKey: "",
            baseUrl: "",
            ...defaultComfyFields(),
          };
    updateProviders([next, ...providers]);
    setSelectedId(id);
    setMobileView("detail");
  };

  const handleConfirmDelete = () => {
    if (!pendingDelete || !isCustomKind(pendingDelete.kind)) {
      setPendingDeleteId(null);
      return;
    }
    const next = providers.filter((p) => p.id !== pendingDelete.id);
    updateProviders(next);
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
        title="生图模型供应商"
        titleIcon={<ImageIcon size={16} className="text-purple-600 dark:text-purple-400" />}
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
              <ul className="space-y-1 list-none">
                {providers.map((p) => (
                  <ImageProviderRow
                    key={p.id}
                    provider={p}
                    isActive={p.id === selectedId}
                    onClick={() => handleSelect(p.id)}
                  />
                ))}
              </ul>
            </div>
            <div className="flex-shrink-0 p-2 border-t border-gray-200 dark:border-white/10">
              <button
                type="button"
                onClick={() => setAddTypeOpen(true)}
                className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl border border-dashed border-gray-300 dark:border-white/20 text-gray-600 dark:text-gray-400 hover:border-purple-400 dark:hover:border-purple-400/60 hover:text-purple-600 dark:hover:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-500/10 transition-all text-sm font-medium"
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
                  <ImageProviderDetail
                    key={selected.id}
                    provider={selected}
                    onUpdate={updateProvider}
                    onOpenManage={() => setManageModelsForId(selected.id)}
                    onRequestDelete={
                      isCustomKind(selected.kind)
                        ? () => setPendingDeleteId(selected.id)
                        : undefined
                    }
                    onOpenWorkflowInfo={() => setWorkflowInfoOpen(true)}
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

      <ImageProviderTypeModal
        isOpen={addTypeOpen}
        onClose={() => setAddTypeOpen(false)}
        onPick={handlePickType}
      />

      <ComfyWorkflowInfoModal
        isOpen={workflowInfoOpen}
        onClose={() => setWorkflowInfoOpen(false)}
      />

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
              ，此操作不可撤销。
            </>
          ) : (
            ""
          )
        }
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDeleteId(null)}
      />

      {manageModelsFor && isManageableKind(manageModelsFor.kind) && (
        <ManageImageModelsModal
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
// List row
// ---------------------------------------------------------------------------

function ImageProviderRow({
  provider,
  isActive,
  onClick,
}: {
  provider: ImageProvider;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`w-full flex items-center gap-2 py-2 px-2 rounded-lg text-left transition-all ${
          isActive
            ? "bg-purple-500/10 dark:bg-purple-500/20 ring-1 ring-purple-500"
            : "hover:bg-white dark:hover:bg-white/5"
        }`}
      >
        <span className="w-5 h-5 flex items-center justify-center flex-shrink-0">
          <ImageProviderIcon kind={provider.kind} size={18} />
        </span>
        <span
          className={`flex-1 truncate text-sm ${
            isActive
              ? "text-purple-700 dark:text-purple-400 font-medium"
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
    </li>
  );
}

// ---------------------------------------------------------------------------
// Detail router
// ---------------------------------------------------------------------------

interface ImageProviderDetailProps {
  provider: ImageProvider;
  onUpdate: (next: ImageProvider) => void;
  onOpenManage: () => void;
  onRequestDelete?: () => void;
  onOpenWorkflowInfo: () => void;
}

function ImageProviderDetail(props: ImageProviderDetailProps) {
  if (isComfyKind(props.provider.kind)) {
    return <ComfyProviderDetail {...props} />;
  }
  return <OpenAiProviderDetail {...props} />;
}

// ---------------------------------------------------------------------------
// Shared header (icon + name [+ editable] + enabled toggle + delete)
// ---------------------------------------------------------------------------

function DetailHeader({
  provider,
  subtitle,
  onUpdate,
  onRequestDelete,
}: {
  provider: ImageProvider;
  subtitle: string;
  onUpdate: (next: ImageProvider) => void;
  onRequestDelete?: () => void;
}) {
  const editable = isCustomKind(provider.kind);
  const [draftName, setDraftName] = useState(provider.name);

  const handleNameBlur = () => {
    const name = draftName.trim() || provider.name;
    if (name !== provider.name) onUpdate({ ...provider, name });
  };

  return (
    <div className="flex items-start gap-3 pb-4 border-b border-gray-100 dark:border-white/5">
      <span className="w-10 h-10 flex items-center justify-center bg-gray-100 dark:bg-white/5 rounded-xl flex-shrink-0">
        <ImageProviderIcon kind={provider.kind} size={22} />
      </span>
      <div className="flex-1 min-w-0">
        {editable ? (
          <input
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={handleNameBlur}
            className="w-full text-lg font-semibold bg-transparent border-b border-transparent hover:border-gray-200 dark:hover:border-white/10 focus:border-purple-500 focus:outline-none text-gray-900 dark:text-gray-100 transition-colors"
          />
        ) : (
          <h3 className="text-lg font-semibold truncate text-gray-900 dark:text-gray-100">
            {provider.name}
          </h3>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <ToggleSwitch
          checked={provider.enabled}
          onChange={(next) => onUpdate({ ...provider, enabled: next })}
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
  );
}

// ---------------------------------------------------------------------------
// OpenAI-compatible detail (qiny + openai-custom)
// ---------------------------------------------------------------------------

function OpenAiProviderDetail({
  provider,
  onUpdate,
  onOpenManage,
  onRequestDelete,
}: ImageProviderDetailProps) {
  const [draftApiKey, setDraftApiKey] = useState(provider.apiKey);
  const [draftBaseUrl, setDraftBaseUrl] = useState(provider.baseUrl);
  const isQiny = provider.kind === "qiny";

  const handleApiKeyBlur = () => {
    if (draftApiKey !== provider.apiKey) onUpdate({ ...provider, apiKey: draftApiKey });
  };
  const handleBaseUrlBlur = () => {
    const v = draftBaseUrl.trim();
    if (v !== provider.baseUrl) onUpdate({ ...provider, baseUrl: v });
  };
  const handleSizeChange = (next: ImageSize) => {
    if ((provider.size ?? "default") === next) return;
    onUpdate({ ...provider, size: next });
  };
  const handleQinyEndpointSelect = (ep: QinyEndpoint) => {
    if (provider.baseUrl === ep.imageBaseUrl) return;
    onUpdate({ ...provider, baseUrl: ep.imageBaseUrl });
  };
  const handleDeleteModel = (modelId: string) => {
    const next: ImageProvider = {
      ...provider,
      models: provider.models.filter((m) => m.id !== modelId),
    };
    if (next.lastUsedModel === modelId) next.lastUsedModel = undefined;
    onUpdate(next);
  };

  const canManage = isQiny ? !!provider.apiKey : !!provider.baseUrl && !!provider.apiKey;

  return (
    <div className="space-y-6">
      <DetailHeader
        provider={provider}
        subtitle={isQiny ? "OpenAI 兼容（内置）" : "自定义 OpenAI 兼容端点"}
        onUpdate={onUpdate}
        onRequestDelete={onRequestDelete}
      />

      {isQiny && (
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
          <FieldHint>国内使用 .com 节点，海外或翻墙后使用.icu 节点</FieldHint>
        </Field>
      )}

      {!isQiny && (
        <Field label="API 地址">
          <input
            type="text"
            value={draftBaseUrl}
            onChange={(e) => setDraftBaseUrl(e.target.value)}
            onBlur={handleBaseUrlBlur}
            placeholder="https://your-host/v1/chat/completions"
            className="w-full px-3 py-2 border border-gray-200 dark:border-white/10 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-gray-50 dark:bg-[#1A1A1A] text-gray-900 dark:text-gray-100 outline-none transition-all placeholder:text-gray-400 dark:placeholder:text-gray-600 text-sm font-mono"
          />
          <FieldHint>
            OpenAI 兼容的图片生成端点地址；「管理模型」会从该地址的 /v1/models 拉取清单。
          </FieldHint>
        </Field>
      )}

      <Field
        label="API Key"
        actionSlot={
          isQiny && (
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
        {isQiny && (
          <FieldHint>
            QinyAPI 端点由上方「QingAPI 接入点」决定,无需手动填写 API 地址。
          </FieldHint>
        )}
      </Field>

      {/* 图片尺寸 — QinyAPI only; removed for openai-custom per spec. */}
      {isQiny && (
        <Field label="图片尺寸">
          <div className="flex flex-wrap gap-2">
            {(
              [
                { value: "default" as ImageSize, label: "默认" },
                { value: "4k" as ImageSize, label: "4K" },
              ]
            ).map((opt) => {
              const active = (provider.size ?? "default") === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleSizeChange(opt.value)}
                  className={`px-4 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                    active
                      ? "border-purple-500 bg-purple-500/10 dark:bg-purple-500/15 ring-1 ring-purple-500 text-purple-600 dark:text-purple-400"
                      : "border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#1A1A1A] text-gray-900 dark:text-gray-100 hover:border-gray-300 dark:hover:border-white/20"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <FieldHint>
            仅 gpt-image-2 等支持 3840×2160 的模型令牌分组下有效;不支持的模型即使开启也会被自动忽略,fallback 到默认尺寸。
          </FieldHint>
        </Field>
      )}

      <ModelListField
        provider={provider}
        onOpenManage={onOpenManage}
        onDeleteModel={handleDeleteModel}
        canManage={canManage}
        disabledHint={
          isQiny ? "请先填写 API Key" : "请先填写 API 地址与 API Key"
        }
      />
    </div>
  );
}

function ModelListField({
  provider,
  onOpenManage,
  onDeleteModel,
  canManage,
  disabledHint,
}: {
  provider: ImageProvider;
  onOpenManage: () => void;
  onDeleteModel: (id: string) => void;
  canManage: boolean;
  disabledHint: string;
}) {
  return (
    <Field label="模型列表">
      <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#1A1A1A] overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-white/10 bg-white/50 dark:bg-black/20">
          <button
            type="button"
            onClick={onOpenManage}
            disabled={!canManage}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-white/20 hover:bg-gray-50 dark:hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-gray-200 dark:disabled:hover:border-white/10 transition-all"
            title={!canManage ? disabledHint : "拉取并选择启用的生图模型"}
          >
            <ListChecks size={14} />
            管理模型
          </button>
          <span className="ml-auto text-[11px] text-gray-400 dark:text-gray-500">
            共 {provider.models.length} 个模型
          </span>
        </div>
        {provider.models.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            暂无已启用的模型
            <br />
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {canManage ? "点击「管理模型」从清单中启用" : disabledHint}
            </span>
          </div>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-white/5">
            {provider.models.map((m) => (
              <ImageModelRow key={m.id} entry={m} onDelete={() => onDeleteModel(m.id)} />
            ))}
          </ul>
        )}
      </div>
    </Field>
  );
}

// ---------------------------------------------------------------------------
// ComfyUI detail (comfyui-fixed + comfyui-custom)
// ---------------------------------------------------------------------------

function ComfyProviderDetail({
  provider,
  onUpdate,
  onRequestDelete,
  onOpenWorkflowInfo,
}: ImageProviderDetailProps) {
  const isCustom = provider.kind === "comfyui-custom";
  const [draftBaseUrl, setDraftBaseUrl] = useState(provider.baseUrl);
  const [artOptions, setArtOptions] = useState<ArtStyleOption[]>([]);

  // Health-check state (connectivity probe, no image generation).
  const [healthStatus, setHealthStatus] = useState<"idle" | "checking" | "ok" | "error">("idle");
  const [healthMsg, setHealthMsg] = useState<string | null>(null);
  const healthAbortRef = useRef<AbortController | null>(null);

  // Test-generation state.
  const [testStatus, setTestStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [testProgress, setTestProgress] = useState<ComfyProgress | null>(null);
  const [testImage, setTestImage] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const testAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    loadArtList(ac.signal)
      .then(setArtOptions)
      .catch(() => setArtOptions([]));
    return () => ac.abort();
  }, []);

  useEffect(() => {
    // Abort any in-flight test / health check if we switch providers / unmount.
    return () => {
      testAbortRef.current?.abort();
      healthAbortRef.current?.abort();
    };
  }, []);

  const handleBaseUrlBlur = () => {
    const v = draftBaseUrl.trim().replace(/[/#]+$/g, "");
    if (v !== provider.baseUrl) onUpdate({ ...provider, baseUrl: v });
  };
  const handleSizeChange = (next: ComfyImageSize) => {
    if ((provider.comfySize ?? "1024x1024") === next) return;
    onUpdate({ ...provider, comfySize: next });
  };
  const handleWorkflowChange = (wfId: string) => {
    const wf = COMFY_WORKFLOWS.find((w) => w.id === wfId);
    if (!wf || wf.disabled) return;
    onUpdate({
      ...provider,
      comfyWorkflowId: wf.id,
      models: [{ id: wf.name }],
      lastUsedModel: wf.name,
    });
  };
  const handleArtChange = (name: string) => {
    if (provider.comfyArtStyle === name) return;
    onUpdate({ ...provider, comfyArtStyle: name });
  };

  const handleTest = async () => {
    if (testStatus === "running") return;
    setTestStatus("running");
    setTestProgress(null);
    setTestError(null);
    setTestImage(null);
    const ac = new AbortController();
    testAbortRef.current = ac;
    try {
      const promptRes = await fetch("/comfyui/TestPrompt.md", { signal: ac.signal });
      const prompt = (await promptRes.text()).trim();
      const url = await generateComfyImage({
        provider,
        prompt,
        onProgress: (p) => setTestProgress(p),
        signal: ac.signal,
      });
      setTestImage(url);
      setTestStatus("done");
    } catch (err: any) {
      if (ac.signal.aborted) {
        setTestStatus("idle");
        return;
      }
      setTestError(err?.message || String(err));
      setTestStatus("error");
    } finally {
      if (testAbortRef.current === ac) testAbortRef.current = null;
    }
  };

  const handleTestStop = () => testAbortRef.current?.abort();

  const handleHealthCheck = async () => {
    if (healthStatus === "checking") return;
    setHealthStatus("checking");
    setHealthMsg(null);
    const ac = new AbortController();
    healthAbortRef.current = ac;
    try {
      const h = await checkComfyHealth(provider, ac.signal);
      setHealthMsg(h.comfyVersion ? `已连通 · ComfyUI ${h.comfyVersion}` : "已连通");
      setHealthStatus("ok");
    } catch (err: any) {
      if (ac.signal.aborted) {
        setHealthStatus("idle");
        return;
      }
      setHealthMsg(err?.message || String(err));
      setHealthStatus("error");
    } finally {
      if (healthAbortRef.current === ac) healthAbortRef.current = null;
    }
  };

  const currentArt = provider.comfyArtStyle ?? "风格4.5.2";
  const currentWorkflow = comfyWorkflowById(provider.comfyWorkflowId);

  return (
    <div className="space-y-6">
      <DetailHeader
        provider={provider}
        subtitle={
          isCustom
            ? "自定义 ComfyUI 服务"
            : COMFYUI_FIXED_DESC || `固定 ComfyUI 服务器（${COMFYUI_FIXED_NAME}）`
        }
        onUpdate={onUpdate}
        onRequestDelete={onRequestDelete}
      />

      {isCustom && (
        <>
          <Field label="ComfyUI 服务器地址">
            <input
              type="text"
              value={draftBaseUrl}
              onChange={(e) => setDraftBaseUrl(e.target.value)}
              onBlur={handleBaseUrlBlur}
              placeholder="http://192.168.1.10:8188"
              className="w-full px-3 py-2 border border-gray-200 dark:border-white/10 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-gray-50 dark:bg-[#1A1A1A] text-gray-900 dark:text-gray-100 outline-none transition-all placeholder:text-gray-400 dark:placeholder:text-gray-600 text-sm font-mono"
            />
            <FieldHint>兼容末尾有无「/」「/#/」；请确保 ComfyUI 已正常运行。</FieldHint>
          </Field>
          <button
            type="button"
            onClick={onOpenWorkflowInfo}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 hover:underline transition-colors"
          >
            <FileText size={14} />
            ComfyUI 工作流配置文档
          </button>
        </>
      )}

      <Field label="连通性检查">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleHealthCheck}
            disabled={healthStatus === "checking" || (isCustom && !provider.baseUrl)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-white/20 hover:bg-gray-50 dark:hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            title={
              isCustom && !provider.baseUrl ? "请先填写服务器地址" : "探测 ComfyUI 服务是否连通（不生图）"
            }
          >
            {healthStatus === "checking" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Activity size={14} />
            )}
            健康检查
          </button>
          {healthStatus === "ok" && (
            <span className="inline-flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
              <CheckCircle2 size={14} />
              {healthMsg}
            </span>
          )}
          {healthStatus === "error" && (
            <span className="inline-flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 break-all">
              <XCircle size={14} className="flex-shrink-0" />
              {healthMsg}
            </span>
          )}
        </div>
        <FieldHint>仅探测服务器是否可访问（请求 /system_stats），不会发起生图。</FieldHint>
      </Field>

      <Field label="尺寸选择">
        <div className="flex flex-wrap gap-2">
          {COMFY_SIZES.map((opt) => {
            const active = (provider.comfySize ?? "1024x1024") === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleSizeChange(opt.value)}
                className={`px-4 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                  active
                    ? "border-purple-500 bg-purple-500/10 dark:bg-purple-500/15 ring-1 ring-purple-500 text-purple-600 dark:text-purple-400"
                    : "border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#1A1A1A] text-gray-900 dark:text-gray-100 hover:border-gray-300 dark:hover:border-white/20"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="工作流选择">
        <div className="flex flex-wrap gap-2">
          {COMFY_WORKFLOWS.map((wf) => {
            const active = (provider.comfyWorkflowId ?? "anima2d") === wf.id;
            return (
              <button
                key={wf.id}
                type="button"
                disabled={wf.disabled}
                onClick={() => handleWorkflowChange(wf.id)}
                title={wf.disabled ? "留待后续开发" : undefined}
                className={`px-4 py-1.5 rounded-lg border text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                  active
                    ? "border-purple-500 bg-purple-500/10 dark:bg-purple-500/15 ring-1 ring-purple-500 text-purple-600 dark:text-purple-400"
                    : "border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#1A1A1A] text-gray-900 dark:text-gray-100 hover:border-gray-300 dark:hover:border-white/20"
                }`}
              >
                {wf.name}
              </button>
            );
          })}
        </div>
        <FieldHint>工作流名称即对话框上方画图模型列表中显示的名称。</FieldHint>
      </Field>

      {currentWorkflow.usesArtStyle && (
        <Field label="画风选择">
          <select
            value={currentArt}
            onChange={(e) => handleArtChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 dark:border-white/10 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-gray-50 dark:bg-[#1A1A1A] text-gray-900 dark:text-gray-100 outline-none transition-all text-sm"
          >
            {/* Ensure the saved style is selectable even before artlist loads. */}
            {artOptions.length === 0 && <option value={currentArt}>{currentArt}</option>}
            {artOptions.map((o) => (
              <option key={o.name} value={o.name}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="测试生成">
        <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#1A1A1A] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleTest}
              disabled={testStatus === "running" || (isCustom && !provider.baseUrl)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
              title={isCustom && !provider.baseUrl ? "请先填写服务器地址" : "用测试提示词出图"}
            >
              {testStatus === "running" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Sparkles size={14} />
              )}
              测试生成
            </button>
            {testStatus === "running" && (
              <>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {formatProgress(testProgress)}
                </span>
                <button
                  type="button"
                  onClick={handleTestStop}
                  className="ml-auto text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                >
                  停止
                </button>
              </>
            )}
          </div>
          {testStatus === "error" && testError && (
            <p className="text-xs text-red-600 dark:text-red-400 break-all">{testError}</p>
          )}
          {testImage && (
            <img
              src={testImage}
              alt="测试生成结果"
              className="max-h-72 w-auto rounded-lg border border-gray-200 dark:border-white/10"
            />
          )}
        </div>
        <FieldHint>以当前 尺寸 / 工作流 / 画风 与内置测试提示词发起一次出图（不写入对话）。</FieldHint>
      </Field>
    </div>
  );
}

function formatProgress(p: ComfyProgress | null): string {
  if (!p) return "提交中…";
  const parts: string[] = [];
  if (typeof p.queueRemaining === "number") parts.push(`排队 ${p.queueRemaining}`);
  if (typeof p.percent === "number") parts.push(`进度 ${p.percent}%`);
  return parts.length > 0 ? parts.join(" · ") : "生成中…";
}

function ImageModelRow({ entry, onDelete }: { entry: ModelEntry; onDelete: () => void }) {
  return (
    <li className="flex items-center gap-2 px-4 py-2.5 text-sm">
      <DeleteModelButton onConfirm={onDelete} />
      <span className="font-mono text-gray-700 dark:text-gray-300 truncate flex-1">
        {entry.id}
      </span>
    </li>
  );
}
