import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { LlmProvider, ModelEntry } from "../types";
import { BaseModal } from "./BaseModal";
import { Field, FieldHint } from "./SettingsFormBits";
import { LlmProviderIcon } from "./icons/providerIcons";

interface AddModelModalProps {
  isOpen: boolean;
  onClose: () => void;
  provider: LlmProvider;
  /** Commits the new entry to the provider's `models[]`. */
  onAdd: (entry: ModelEntry) => void;
}

/**
 * Manually add a model to a provider's saved `models[]` by typing its API
 * model id — the escape hatch for SKUs the upstream `/v1/models` list doesn't
 * surface (DeepSeek / Gemini 等渠道的内测或灰度模型，只能手写模型名才能调用与
 * 健康测试)。管理模型 only lists what the endpoint returns, so those models
 * have no other way in.
 *
 * 显示名称 is optional and only affects labels in the UI; requests always carry
 * the raw `id`.
 */
export function AddModelModal({
  isOpen,
  onClose,
  provider,
  onAdd,
}: AddModelModalProps) {
  const [modelId, setModelId] = useState("");
  const [displayName, setDisplayName] = useState("");

  // Re-seed the drafts every time the dialog opens so a cancelled edit
  // doesn't leak into the next invocation.
  useEffect(() => {
    if (!isOpen) return;
    setModelId("");
    setDisplayName("");
  }, [isOpen]);

  const trimmedId = modelId.trim();
  const trimmedName = displayName.trim();
  const isDuplicate =
    trimmedId !== "" && provider.models.some((m) => m.id === trimmedId);
  const canSubmit = trimmedId !== "" && !isDuplicate;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const entry: ModelEntry = trimmedName
      ? { id: trimmedId, name: trimmedName }
      : { id: trimmedId };
    onAdd(entry);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && canSubmit) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2 truncate">
          <span className="w-5 h-5 inline-flex items-center justify-center flex-shrink-0">
            <LlmProviderIcon kind={provider.kind} size={18} />
          </span>
          <span className="truncate">{provider.name} · 添加模型</span>
        </span>
      }
      titleIcon={
        <Plus size={16} className="text-blue-600 dark:text-blue-400" />
      }
      maxWidth="max-w-md"
      footer={
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 hover:bg-gray-200 dark:bg-white/5 dark:hover:bg-white/10 rounded-xl transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            添加
          </button>
        </div>
      }
    >
      <div className="p-5 space-y-5">
        <Field label="模型 ID">
          <input
            type="text"
            value={modelId}
            data-autofocus
            onChange={(e) => setModelId(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="例如 deepseek-chat-exp"
            spellCheck={false}
            autoComplete="off"
            className="w-full px-4 py-3 border border-gray-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50 dark:bg-[#1A1A1A] text-gray-900 dark:text-gray-100 outline-none transition-all placeholder:text-gray-400 dark:placeholder:text-gray-600 font-mono text-sm"
          />
          {isDuplicate ? (
            <p className="text-[11px] text-red-600 dark:text-red-400 mt-2">
              该模型 ID 已在当前供应商的模型列表中
            </p>
          ) : (
            <FieldHint>
              必须与上游 API 请求体里的 <code className="font-mono">model</code>{" "}
              字段完全一致，区分大小写。
            </FieldHint>
          )}
        </Field>

        <Field label="显示名称">
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="留空则显示模型 ID"
            autoComplete="off"
            className="w-full px-4 py-3 border border-gray-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50 dark:bg-[#1A1A1A] text-gray-900 dark:text-gray-100 outline-none transition-all placeholder:text-gray-400 dark:placeholder:text-gray-600 text-sm"
          />
          <FieldHint>仅用于界面展示，不影响实际调用的模型名。</FieldHint>
        </Field>

        <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
          用于添加供应商模型清单里没有列出的模型（DeepSeek、Gemini
          等渠道的测试用模型）。添加后可直接在「模型列表」里对它运行健康测试。
        </p>
      </div>
    </BaseModal>
  );
}
