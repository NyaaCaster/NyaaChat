import { useEffect, useId, useMemo, useState } from "react";
import { ListChecks, Loader2, RefreshCw, Search } from "lucide-react";
import { ApiSettings, ImageProvider, ModelEntry } from "../types";
import { BaseModal } from "./BaseModal";
import { ImageProviderIcon } from "./icons/providerIcons";
import { fetchModels } from "../lib/api";

interface ManageImageModelsModalProps {
  isOpen: boolean;
  onClose: () => void;
  provider: ImageProvider;
  onUpdate: (next: ImageProvider) => void;
}

type FetchStatus = "idle" | "loading" | "ready" | "error";

/**
 * Image-side counterpart of ManageModelsModal. Differences from the LLM
 * variant:
 *   - the provider is `ImageProvider` (no apiFormat field, always OpenAI-
 *     compatible for QinyAPI)
 *   - the live model list is filtered to drop entries whose id contains
 *     "video" (carryover from the original SettingsModal — QinyAPI returns
 *     both image and video models from /v1/models)
 *   - no health-check column hooks; image gen quality is judged via real
 *     usage, not minimum-token probes
 *   - first model added auto-enables the provider, same as the LLM variant
 */
export function ManageImageModelsModal({
  isOpen,
  onClose,
  provider,
  onUpdate,
}: ManageImageModelsModalProps) {
  const [status, setStatus] = useState<FetchStatus>("idle");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setStatus("idle");
      return;
    }
    const ac = new AbortController();
    setStatus("loading");
    setErrorMessage(null);
    // QinyAPI image gen exposes /v1/models on the same host that handles
    // chat completions, so we reuse the chat-side fetcher with an OpenAI-
    // shaped settings object derived directly from the provider fields
    // (avoids ApiSettings/ImageApiSettings shape mismatch — baseUrl is
    // optional on the latter).
    const apiSettings: ApiSettings = {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: provider.lastUsedModel ?? provider.models[0]?.id ?? "",
      apiFormat: "openai",
    };
    fetchModels(apiSettings, ac.signal)
      .then((list) => {
        if (ac.signal.aborted) return;
        setAvailableModels(list.filter((id) => !/video/i.test(id)));
        setStatus("ready");
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setErrorMessage(err?.message || String(err));
        setAvailableModels([]);
        setStatus("error");
      });
    return () => ac.abort();
    // Same dependency rationale as ManageModelsModal — restrict to the
    // fields that actually affect the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, provider.apiKey, provider.baseUrl, provider.kind]);

  // Mirrors ManageModelsModal: only show what the live API returned. Older
  // entries in provider.models that the current /v1/models doesn't list
  // remain in storage but aren't toggleable here.
  const enabledIds = useMemo(
    () => new Set(provider.models.map((m) => m.id)),
    [provider.models],
  );
  const filteredIds = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return availableModels;
    return availableModels.filter((id) => id.toLowerCase().includes(q));
  }, [availableModels, query]);

  const handleToggle = (modelId: string, enable: boolean) => {
    const wasEmpty = provider.models.length === 0;
    let nextModels: ModelEntry[];
    if (enable) {
      if (provider.models.find((m) => m.id === modelId)) return;
      nextModels = [...provider.models, { id: modelId }];
    } else {
      nextModels = provider.models.filter((m) => m.id !== modelId);
    }
    const next: ImageProvider = {
      ...provider,
      models: nextModels,
      enabled: enable && wasEmpty ? true : provider.enabled,
    };
    if (!enable && next.lastUsedModel === modelId) {
      next.lastUsedModel = undefined;
    }
    onUpdate(next);
  };

  const handleRefresh = () => {
    if (status === "loading") return;
    setStatus("loading");
    setErrorMessage(null);
    const apiSettings: ApiSettings = {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: provider.lastUsedModel ?? provider.models[0]?.id ?? "",
      apiFormat: "openai",
    };
    fetchModels(apiSettings)
      .then((list) => {
        setAvailableModels(list.filter((id) => !/video/i.test(id)));
        setStatus("ready");
      })
      .catch((err) => {
        setErrorMessage(err?.message || String(err));
        setAvailableModels([]);
        setStatus("error");
      });
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2 truncate">
          <span className="w-5 h-5 inline-flex items-center justify-center flex-shrink-0">
            <ImageProviderIcon kind={provider.kind} size={18} />
          </span>
          <span className="truncate">{provider.name} · 管理模型</span>
        </span>
      }
      titleIcon={
        <ListChecks size={16} className="text-purple-600 dark:text-purple-400" />
      }
      maxWidth="max-w-2xl"
    >
      <div className="flex flex-col h-[600px] max-h-[70vh]">
        <div className="flex items-center gap-2 p-4 border-b border-gray-100 dark:border-white/5 flex-shrink-0">
          <div className="relative flex-1">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索模型..."
              className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-white/10 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-gray-50 dark:bg-[#1A1A1A] text-gray-900 dark:text-gray-100 outline-none transition-all placeholder:text-gray-400 dark:placeholder:text-gray-600 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={status === "loading"}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-white/20 hover:bg-gray-50 dark:hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex-shrink-0"
            title="重新拉取模型清单"
          >
            <RefreshCw
              size={14}
              className={status === "loading" ? "animate-spin" : ""}
            />
            刷新
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {status === "loading" && availableModels.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-sm text-gray-500 dark:text-gray-400">
              <Loader2 size={20} className="animate-spin text-purple-500" />
              拉取模型清单中…
            </div>
          )}

          {status === "error" && availableModels.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-sm">
              <p className="text-red-600 dark:text-red-400 text-center break-all max-w-md">
                {errorMessage || "请求失败"}
              </p>
              <button
                type="button"
                onClick={handleRefresh}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 hover:bg-purple-700 text-white transition-colors"
              >
                <RefreshCw size={14} />
                重试
              </button>
            </div>
          )}

          {(status === "ready" || availableModels.length > 0) && (
            <>
              {filteredIds.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">
                  {query ? "无匹配的模型" : "供应商未返回任何模型"}
                </div>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-white/5">
                  {filteredIds.map((id) => (
                    <ImageModelRow
                      key={id}
                      modelId={id}
                      isEnabled={enabledIds.has(id)}
                      onToggle={(v) => handleToggle(id, v)}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-gray-100 dark:border-white/5 flex-shrink-0 text-[11px] text-gray-500 dark:text-gray-400">
          <span>
            清单 {availableModels.length} 项 · 已启用 {enabledIds.size} 项
          </span>
          {status === "loading" && availableModels.length > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 size={11} className="animate-spin" />
              刷新中
            </span>
          )}
        </div>
      </div>
    </BaseModal>
  );
}

interface ImageModelRowProps {
  modelId: string;
  isEnabled: boolean;
  onToggle: (next: boolean) => void;
}

function ImageModelRow({
  modelId,
  isEnabled,
  onToggle,
}: ImageModelRowProps) {
  const id = useId();
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
      <span className="flex-1 min-w-0">
        <span className="font-mono text-sm text-gray-900 dark:text-gray-100 truncate block">
          {modelId}
        </span>
      </span>
      {/* The toggle is wrapped in <label htmlFor> so clicking either the
          visual track or the (sr-only) input flips the checkbox. Without
          the label wrap the visual span has no click target and only
          keyboard activation works. */}
      <label
        htmlFor={id}
        className="relative inline-flex items-center flex-shrink-0 cursor-pointer"
        title={isEnabled ? "已启用" : "已停用"}
      >
        <input
          id={id}
          type="checkbox"
          className="sr-only peer"
          checked={isEnabled}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-purple-500/50 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-purple-500"></span>
      </label>
    </li>
  );
}
