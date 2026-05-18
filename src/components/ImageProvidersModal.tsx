import { useEffect, useState } from "react";
import { ArrowLeft, Image as ImageIcon, ListChecks } from "lucide-react";
import { AppState, ImageProvider, ImageSize, ModelEntry } from "../types";
import { BaseModal } from "./BaseModal";
import { ApiKeyInput } from "./ApiKeyInput";
import { Field, FieldHint, ToggleSwitch } from "./SettingsFormBits";
import { ImageProviderIcon } from "./icons/providerIcons";
import { ManageImageModelsModal } from "./ManageImageModelsModal";

interface ImageProvidersModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppState;
  onSave: (settings: AppState) => void;
}

/**
 * Image-side counterpart of LlmProvidersModal. Diffs from the chat variant:
 *   - fixed list of providers (no add-provider button, no drag) — only
 *     QinyAPI and ComfyUI ship today
 *   - QinyAPI shows API Key + 模型列表 (no health-test button)
 *   - ComfyUI is a placeholder ("尽请期待"), enabled toggle disabled
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

  useEffect(() => {
    if (!providers.find((p) => p.id === selectedId) && providers[0]) {
      setSelectedId(providers[0].id);
    }
  }, [providers, selectedId]);

  useEffect(() => {
    if (isOpen) setMobileView("list");
  }, [isOpen]);

  const selected = providers.find((p) => p.id === selectedId);
  const manageModelsFor =
    providers.find((p) => p.id === manageModelsForId) ?? null;

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

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onClose={onClose}
        title="生图模型供应商"
        titleIcon={
          <ImageIcon size={16} className="text-purple-600 dark:text-purple-400" />
        }
        maxWidth="max-w-5xl"
      >
        <div className="flex flex-col sm:flex-row h-[600px] max-h-[70vh]">
          {/* Provider list pane */}
          <div
            className={`${
              mobileView === "detail" ? "hidden" : "flex"
            } sm:flex flex-col w-full sm:w-72 sm:border-r border-gray-200 dark:border-white/10 bg-gray-50/50 dark:bg-black/20 min-h-0`}
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
            {/* Image providers are a closed set today — no "+ 添加供应商"
                button per spec. The footer is intentionally absent. */}
          </div>

          {/* Detail pane */}
          <div
            className={`${
              mobileView === "list" ? "hidden" : "flex"
            } sm:flex flex-col flex-1 min-h-0`}
          >
            {selected ? (
              <>
                <div className="sm:hidden flex items-center gap-2 p-3 border-b border-gray-200 dark:border-white/10 flex-shrink-0">
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
      {manageModelsFor && manageModelsFor.kind === "qiny" && (
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

interface ImageProviderRowProps {
  provider: ImageProvider;
  isActive: boolean;
  onClick: () => void;
}

function ImageProviderRow({
  provider,
  isActive,
  onClick,
}: ImageProviderRowProps) {
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
// Detail (right column)
// ---------------------------------------------------------------------------

interface ImageProviderDetailProps {
  provider: ImageProvider;
  onUpdate: (next: ImageProvider) => void;
  onOpenManage: () => void;
}

function ImageProviderDetail({
  provider,
  onUpdate,
  onOpenManage,
}: ImageProviderDetailProps) {
  const [draftApiKey, setDraftApiKey] = useState(provider.apiKey);

  const handleApiKeyBlur = () => {
    if (draftApiKey !== provider.apiKey) {
      onUpdate({ ...provider, apiKey: draftApiKey });
    }
  };

  const handleEnabledToggle = (next: boolean) => {
    onUpdate({ ...provider, enabled: next });
  };

  const handleSizeChange = (next: ImageSize) => {
    if ((provider.size ?? "default") === next) return;
    onUpdate({ ...provider, size: next });
  };

  // ComfyUI ships as a placeholder for now per the spec. Show only the
  // header and a "尽请期待" banner; enabled toggle is rendered disabled.
  if (provider.kind === "comfyui") {
    return (
      <div className="space-y-6">
        <DetailHeader
          provider={provider}
          onEnabledToggle={handleEnabledToggle}
          enabledDisabled
        />
        <div className="rounded-xl border border-dashed border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#1A1A1A] py-12 text-center text-sm text-gray-500 dark:text-gray-400">
          尽请期待
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DetailHeader
        provider={provider}
        onEnabledToggle={handleEnabledToggle}
      />

      <Field
        label="API Key"
        actionSlot={
          provider.kind === "qiny" && (
            <a
              href="https://openai.chatnewai.com/register?aff=btB0"
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
        <FieldHint>
          QinyAPI 端点固定为 https://openai.chatnewai.com/v1,无需填写 API 地址。
        </FieldHint>
      </Field>

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

      <Field label="模型列表">
        <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#1A1A1A] overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-white/10 bg-white/50 dark:bg-black/20">
            <button
              type="button"
              onClick={onOpenManage}
              disabled={!provider.apiKey}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-white/20 hover:bg-gray-50 dark:hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-gray-200 dark:disabled:hover:border-white/10 transition-all"
              title={
                !provider.apiKey
                  ? "请先填写 API Key"
                  : "拉取并选择启用的生图模型"
              }
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
                {provider.apiKey
                  ? "点击「管理模型」从清单中启用"
                  : "请先填写 API Key,再点击「管理模型」"}
              </span>
            </div>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-white/5">
              {provider.models.map((m) => (
                <ImageModelRow key={m.id} entry={m} />
              ))}
            </ul>
          )}
        </div>
      </Field>
    </div>
  );
}

interface DetailHeaderProps {
  provider: ImageProvider;
  onEnabledToggle: (next: boolean) => void;
  enabledDisabled?: boolean;
}

function DetailHeader({
  provider,
  onEnabledToggle,
  enabledDisabled = false,
}: DetailHeaderProps) {
  return (
    <div className="flex items-start gap-3 pb-4 border-b border-gray-100 dark:border-white/5">
      <span className="w-10 h-10 flex items-center justify-center bg-gray-100 dark:bg-white/5 rounded-xl flex-shrink-0">
        <ImageProviderIcon kind={provider.kind} size={22} />
      </span>
      <div className="flex-1 min-w-0">
        <h3 className="text-lg font-semibold truncate text-gray-900 dark:text-gray-100">
          {provider.name}
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {provider.kind === "comfyui" ? "本地部署 (尽请期待)" : provider.kind}
        </p>
      </div>
      <ToggleSwitch
        checked={provider.enabled}
        onChange={onEnabledToggle}
        label={provider.enabled ? "已启用" : "已禁用"}
        disabled={enabledDisabled}
      />
    </div>
  );
}

function ImageModelRow({ entry }: { entry: ModelEntry }) {
  return (
    <li className="flex items-center gap-2 px-4 py-2.5 text-sm">
      <span className="font-mono text-gray-700 dark:text-gray-300 truncate flex-1">
        {entry.id}
      </span>
    </li>
  );
}
