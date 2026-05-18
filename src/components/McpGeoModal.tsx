import { useEffect, useMemo, useState } from "react";
import { MapPin, X as XIcon } from "lucide-react";
import { BaseModal } from "./BaseModal";
import {
  McpCity,
  MCP_CITIES,
  searchCities,
} from "../lib/mcpCities";

interface McpGeoModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Current value of `settings.mcpUserCity`. Null = no override. */
  currentCity: string | null;
  onChange: (next: string | null) => void;
}

const GROUP_LABEL: Record<McpCity["group"], string> = {
  country: "国家",
  municipality: "直辖市",
  province: "省",
  autonomous: "自治区",
  sar: "特别行政区",
};

export function McpGeoModal({
  isOpen,
  onClose,
  currentCity,
  onChange,
}: McpGeoModalProps) {
  const [query, setQuery] = useState("");

  // Reset the typeahead query whenever the modal reopens — stale "wrong
  // input" from a previous session would otherwise be the first thing the
  // user sees.
  useEffect(() => {
    if (isOpen) setQuery("");
  }, [isOpen]);

  // When the input is empty show a "browse all" candidate list (the full
  // 64-entry table), so the user can pick visually without typing.
  const candidates = useMemo(() => {
    if (!query.trim()) return MCP_CITIES.slice(0, 12);
    return searchCities(query);
  }, [query]);

  const handleSelect = (city: McpCity) => {
    onChange(city.value);
    onClose();
  };

  const handleClear = () => {
    setQuery("");
    onChange(null);
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="地理信息设置"
      titleIcon={<MapPin size={16} className="text-blue-600 dark:text-blue-400" />}
      maxWidth="max-w-md"
    >
      <div className="p-4 sm:p-5 space-y-4">
        <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">
          本工具不会读取您的真实地理坐标信息，请<Hl>选择一个城市</Hl>作为您角色扮演时身处的地理位置，本工具将根据此地理位置获得<Hl>真实时间</Hl>和<Hl>实时天气</Hl>数据，用于在对话中进行身临其境的角色扮演。（如果不设置所在城市，在 MCP 工具开启时，将<Hl>默认使用北京</Hl>作为获取时间和天气的地理坐标。）
        </p>

        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-white/5 border border-gray-200/60 dark:border-white/10">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            当前所在城市
          </span>
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {currentCity ?? "无"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入城市 / 国家 / 省份名（中文或英文）"
            data-autofocus
            className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1A1A1A] text-sm placeholder-gray-400 dark:placeholder-gray-600 outline-none focus:ring-2 focus:ring-blue-500/40"
          />
          <button
            type="button"
            onClick={handleClear}
            title="清除已选城市并重置输入"
            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors flex-shrink-0"
          >
            <XIcon size={12} />
            <span>清除</span>
          </button>
        </div>

        <div className="rounded-lg border border-gray-200/60 dark:border-white/10 overflow-hidden">
          {candidates.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-gray-500 dark:text-gray-400">
              没有匹配项，请尝试其他关键字
            </div>
          ) : (
            <ul className="max-h-64 overflow-y-auto divide-y divide-gray-100 dark:divide-white/5">
              {candidates.map((c) => {
                const isCurrent = c.value === currentCity;
                return (
                  <li key={c.value}>
                    <button
                      type="button"
                      onClick={() => handleSelect(c)}
                      className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left transition-colors ${
                        isCurrent
                          ? "bg-blue-500/10 text-blue-700 dark:text-blue-300"
                          : "hover:bg-gray-50 dark:hover:bg-white/5 text-gray-800 dark:text-gray-200"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 w-12 flex-shrink-0">
                          {GROUP_LABEL[c.group]}
                        </span>
                        <span className="text-sm font-medium truncate">{c.label}</span>
                        {c.resolvesTo !== c.value && (
                          <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            → {c.resolvesTo}
                          </span>
                        )}
                      </div>
                      {isCurrent && (
                        <span className="text-[10px] font-sans flex-shrink-0">当前</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </BaseModal>
  );
}

// Inline highlight for the explainer paragraph. Tinted blue + semibold
// rather than backgrounded — keeps the prose flowing while still pulling
// the eye to the actionable nouns.
function Hl({ children }: { children: React.ReactNode }) {
  return (
    <strong className="font-semibold text-blue-600 dark:text-blue-400">
      {children}
    </strong>
  );
}
