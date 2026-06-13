import React, { useEffect, useState } from "react";
import { Puzzle, RefreshCw } from "lucide-react";
import { BaseModal } from "./BaseModal";
import {
  resolveExtensions,
  saveUserPref,
  isExtensionLoaded,
  type ResolvedExtension,
} from "../compat";

interface ExtensionsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * User-facing extension panel (decision B-revised). Lists root-enabled
 * extensions and lets the user toggle each for themselves; the preference is
 * stored in localStorage and read by the loader on the next page load. There is
 * NO install / update / delete here — that's operator-only via git + rebuild.
 *
 * A toggle takes full effect on reload: an extension already injected this
 * session can't be un-injected from a live page, so we surface a "需刷新" hint
 * and offer a reload button when the user's choice diverges from what's loaded.
 */
export function ExtensionsModal({ isOpen, onClose }: ExtensionsModalProps) {
  const [exts, setExts] = useState<ResolvedExtension[]>([]);
  const [loading, setLoading] = useState(false);
  // Track ids whose toggled state no longer matches what's actually loaded, so
  // we can prompt for a reload.
  const [dirty, setDirty] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    resolveExtensions()
      .then((list) => setExts(list))
      .catch(() => setExts([]))
      .finally(() => setLoading(false));
  }, [isOpen]);

  const handleToggle = (ext: ResolvedExtension, next: boolean) => {
    saveUserPref(ext.id, next);
    setExts((prev) =>
      prev.map((e) => (e.id === ext.id ? { ...e, userPref: next, effective: next } : e)),
    );
    // If the new choice differs from what's actually loaded this session, a
    // reload is needed to apply it fully.
    const loaded = isExtensionLoaded(ext.id);
    setDirty((d) => ({ ...d, [ext.id]: next !== loaded }));
  };

  const anyDirty = Object.values(dirty).some(Boolean);

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="扩展"
      titleIcon={<Puzzle size={16} className="text-blue-500" />}
      maxWidth="max-w-lg"
      footer={
        anyDirty ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-amber-600 dark:text-amber-400">
              启停变更需刷新页面后生效
            </span>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              <RefreshCw size={14} />
              刷新
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="p-4 sm:p-5">
        {loading ? (
          <div className="py-10 text-center text-sm text-gray-400">加载中…</div>
        ) : exts.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400 dark:text-gray-500">
            当前没有可用扩展。
            <br />
            扩展由运营方在部署时内置。
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {exts.map((ext) => {
              const enabled = ext.userPref ?? ext.defaultUserEnabled;
              return (
                <li
                  key={ext.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl border border-gray-200/70 dark:border-white/10 bg-gray-50/50 dark:bg-white/5"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 dark:text-gray-100 truncate">
                      {ext.manifest.display_name}
                    </div>
                    <div className="text-xs text-gray-400 dark:text-gray-500 truncate">
                      {ext.manifest.author ? `${ext.manifest.author} · ` : ""}
                      v{ext.manifest.version || "?"}
                      {dirty[ext.id] ? " · 需刷新" : ""}
                    </div>
                  </div>
                  <button
                    role="switch"
                    aria-checked={enabled}
                    onClick={() => handleToggle(ext, !enabled)}
                    className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                      enabled ? "bg-blue-600" : "bg-gray-300 dark:bg-white/15"
                    }`}
                    title={enabled ? "点击禁用" : "点击启用"}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                        enabled ? "translate-x-5" : ""
                      }`}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </BaseModal>
  );
}
