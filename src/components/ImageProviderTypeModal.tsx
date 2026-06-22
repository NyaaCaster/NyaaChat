import { Plus } from "lucide-react";
import { BaseModal } from "./BaseModal";
import { ImageProviderIcon } from "./icons/providerIcons";

export type AddableImageProviderKind = "openai-custom" | "comfyui-custom";

interface ImageProviderTypeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPick: (kind: AddableImageProviderKind) => void;
}

/**
 * Two-choice picker shown after "添加供应商" on the image-provider side.
 * Mirrors the chat side's add flow but, because image providers split into two
 * fundamentally different call mechanics (OpenAI-compatible vs ComfyUI graph),
 * the user picks the type up front rather than getting a single generic custom
 * entry.
 */
export function ImageProviderTypeModal({
  isOpen,
  onClose,
  onPick,
}: ImageProviderTypeModalProps) {
  const choose = (kind: AddableImageProviderKind) => {
    onPick(kind);
    onClose();
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="供应商类型"
      titleIcon={<Plus size={16} className="text-purple-600 dark:text-purple-400" />}
      maxWidth="max-w-md"
    >
      <div className="p-5 sm:p-6 space-y-3">
        <TypeCard
          kind="openai-custom"
          title="自定义 OpenAI 兼容 API"
          desc="任意 OpenAI 图片接口兼容的端点，填写 API 地址与 Key 后拉取模型。"
          onClick={() => choose("openai-custom")}
        />
        <TypeCard
          kind="comfyui-custom"
          title="自定义 ComfyUI 服务"
          desc="接入你自己部署的 ComfyUI 服务器，使用工作流出图。"
          onClick={() => choose("comfyui-custom")}
        />
      </div>
    </BaseModal>
  );
}

function TypeCard({
  kind,
  title,
  desc,
  onClick,
}: {
  kind: AddableImageProviderKind;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-start gap-3 p-4 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#1A1A1A] text-left hover:border-purple-400 dark:hover:border-purple-400/60 hover:bg-purple-50/50 dark:hover:bg-purple-500/10 transition-all"
    >
      <span className="w-10 h-10 flex items-center justify-center bg-white dark:bg-white/5 rounded-xl flex-shrink-0">
        <ImageProviderIcon kind={kind} size={22} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
          {title}
        </span>
        <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
          {desc}
        </span>
      </span>
    </button>
  );
}
