import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Regex, Plus, Pencil, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import type { CharacterSettings, RegexScript } from "../types";
import { BaseModal } from "./BaseModal";
import { loadGlobalRegexScripts, saveGlobalRegexScripts } from "../compat";
import { RegexScriptEditModal } from "./RegexScriptEditModal";

interface RegexModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The active character, whose scoped (local) regex the "角色" tab manages. */
  character?: CharacterSettings | null;
  /** Persist a change to the active character's scoped regex scripts. */
  onUpdateCharacterRegex?: (characterId: string, scripts: RegexScript[]) => void;
}

type Scope = "global" | "scoped";

const PLACEMENT_LABELS: Record<number, string> = {
  1: "用户输入",
  2: "AI 输出",
  3: "斜杠命令",
  5: "世界书",
  6: "推理",
};

function pipelineLabel(s: RegexScript): string {
  if (s.markdownOnly && s.promptOnly) return "显示+提示词";
  if (s.markdownOnly) return "仅显示";
  if (s.promptOnly) return "仅提示词";
  return "不生效";
}

/**
 * Regex script manager. Mirrors SillyTavern's regex extension, which has two
 * scopes (NyaaChat has no presets, so the third — preset regex — is omitted):
 *   - 全局 (Global): user-managed, cross-chat, stored in localStorage.
 *   - 角色 (Scoped/local): travels with the character card, applies only while
 *     that character is active, and shows/hides on character switch.
 * Both scopes share the list + editor UI; only the data source and persistence
 * differ. The display pipeline refreshes live: global via saveGlobalRegexScripts'
 * subscriber notification, scoped via the character reference changing (see
 * ChatInterface).
 */
export function RegexModal({ isOpen, onClose, character, onUpdateCharacterRegex }: RegexModalProps) {
  const [scope, setScope] = useState<Scope>("global");
  const [scripts, setScripts] = useState<RegexScript[]>([]);
  const [editing, setEditing] = useState<RegexScript | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const scopedAvailable = !!character && !!onUpdateCharacterRegex;

  // (Re)load the active scope's scripts whenever the panel opens, the scope tab
  // changes, or the active character changes. Clone so in-place edits don't
  // mutate the source before save.
  useEffect(() => {
    if (!isOpen) return;
    if (scope === "global") {
      setScripts(loadGlobalRegexScripts().map((s) => ({ ...s })));
    } else {
      setScripts((character?.regexScripts ?? []).map((s) => ({ ...s })));
    }
  }, [isOpen, scope, character]);

  // If the panel opens with no usable character, force the global tab.
  useEffect(() => {
    if (isOpen && scope === "scoped" && !scopedAvailable) setScope("global");
  }, [isOpen, scope, scopedAvailable]);

  const persist = (next: RegexScript[]) => {
    setScripts(next);
    if (scope === "global") {
      saveGlobalRegexScripts(next);
    } else if (character && onUpdateCharacterRegex) {
      onUpdateCharacterRegex(character.id, next);
    }
  };

  const handleSaveScript = (script: RegexScript) => {
    const exists = scripts.some((s) => s.id === script.id);
    persist(exists ? scripts.map((s) => (s.id === script.id ? script : s)) : [...scripts, script]);
  };

  const toggleDisabled = (id: string) =>
    persist(scripts.map((s) => (s.id === id ? { ...s, disabled: !s.disabled } : s)));

  const remove = (script: RegexScript) => {
    if (!window.confirm(`删除正则脚本「${script.scriptName}」？`)) return;
    persist(scripts.filter((s) => s.id !== script.id));
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= scripts.length) return;
    const next = [...scripts];
    [next[index], next[target]] = [next[target], next[index]];
    persist(next);
  };

  const openEditor = (script: RegexScript | null) => {
    setEditing(script);
    setEditorOpen(true);
  };

  const tabClass = (active: boolean) =>
    `px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
      active
        ? "bg-blue-600 text-white"
        : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-white/10"
    }`;

  const showScopedHint = scope === "scoped" && !scopedAvailable;

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onClose={onClose}
        title="正则"
        titleIcon={<Regex size={16} className="text-blue-500" />}
        maxWidth="max-w-xl"
        titleAction={
          !showScopedHint ? (
            <button
              onClick={() => openEditor(null)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              title="新建正则脚本"
            >
              <Plus size={15} />
              新建
            </button>
          ) : undefined
        }
      >
        <div className="p-4 sm:p-5">
          {/* Scope tabs: 全局 / 角色 (presets are N/A in NyaaChat). */}
          <div className="flex items-center gap-1 mb-4 p-1 rounded-xl bg-gray-100/70 dark:bg-white/5 w-fit">
            <button className={tabClass(scope === "global")} onClick={() => setScope("global")}>
              全局
            </button>
            <button
              className={tabClass(scope === "scoped")}
              onClick={() => setScope("scoped")}
              title={scopedAvailable ? undefined : "需先选择一个角色"}
            >
              角色{character?.name ? `（${character.name}）` : ""}
            </button>
          </div>

          {showScopedHint ? (
            <div className="py-10 text-center text-sm text-gray-400 dark:text-gray-500">
              没有活动角色。
              <br />
              角色正则跟随角色卡，随角色切换而生效/隐藏。
            </div>
          ) : scripts.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400 dark:text-gray-500">
              {scope === "global" ? "还没有全局正则脚本。" : "该角色还没有局部正则脚本。"}
              <br />
              点击右上角「新建」添加，规则按列表顺序链式作用。
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {scripts.map((s, i) => (
                <li
                  key={s.id}
                  className={`flex items-center gap-2 p-3 rounded-xl border transition-colors ${
                    s.disabled
                      ? "border-gray-200/60 dark:border-white/5 bg-gray-50/40 dark:bg-white/[0.02] opacity-60"
                      : "border-gray-200/70 dark:border-white/10 bg-gray-50/50 dark:bg-white/5"
                  }`}
                >
                  <div className="flex flex-col flex-shrink-0">
                    <button
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      className="p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title="上移"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      onClick={() => move(i, 1)}
                      disabled={i === scripts.length - 1}
                      className="p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title="下移"
                    >
                      <ArrowDown size={14} />
                    </button>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-900 dark:text-gray-100 truncate">
                      {s.scriptName || "(未命名)"}
                    </div>
                    <div className="text-xs text-gray-400 dark:text-gray-500 truncate">
                      {pipelineLabel(s)}
                      {s.placement?.length
                        ? " · " + s.placement.map((p) => PLACEMENT_LABELS[p] ?? p).join("/")
                        : ""}
                    </div>
                  </div>

                  <button
                    role="switch"
                    aria-checked={!s.disabled}
                    onClick={() => toggleDisabled(s.id)}
                    className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                      !s.disabled ? "bg-blue-600" : "bg-gray-300 dark:bg-white/15"
                    }`}
                    title={s.disabled ? "点击启用" : "点击禁用"}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                        !s.disabled ? "translate-x-5" : ""
                      }`}
                    />
                  </button>

                  <button
                    onClick={() => openEditor(s)}
                    className="p-2 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-white/10 rounded-lg transition-all flex-shrink-0"
                    title="编辑"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={() => remove(s)}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-white/10 rounded-lg transition-all flex-shrink-0"
                    title="删除"
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </BaseModal>

      {/* Portal to body: RegexModal's BaseModal card has backdrop-blur, which
          would otherwise pin this nested editor's fixed positioning inside the
          card instead of the viewport. */}
      {createPortal(
        <RegexScriptEditModal
          isOpen={editorOpen}
          onClose={() => setEditorOpen(false)}
          onSave={handleSaveScript}
          initialScript={editing}
        />,
        document.body,
      )}
    </>
  );
}
