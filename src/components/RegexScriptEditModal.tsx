import React, { useState, useEffect } from "react";
import { Regex } from "lucide-react";
import type { RegexScript } from "../types";
import { BaseModal } from "./BaseModal";

interface RegexScriptEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (script: RegexScript) => void;
  initialScript?: RegexScript | null;
}

/** Placement options, mirroring SillyTavern's "Affects" checkboxes. The numeric
 *  codes match regex_placement (engine.ts): 1=USER_INPUT 2=AI_OUTPUT
 *  3=SLASH_COMMAND 5=WORLD_INFO 6=REASONING. */
const PLACEMENTS: { code: number; label: string }[] = [
  { code: 1, label: "用户输入" },
  { code: 2, label: "AI 输出" },
  { code: 3, label: "斜杠命令" },
  { code: 5, label: "世界书" },
  { code: 6, label: "推理" },
];

const SUBSTITUTE_OPTIONS: { value: 0 | 1 | 2; label: string }[] = [
  { value: 0, label: "不替换" },
  { value: 1, label: "原始宏" },
  { value: 2, label: "转义宏" },
];

const fieldLabel =
  "block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2 px-1";
const textInput =
  "w-full px-4 py-3 bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none";
const monoInput = `${textInput} font-mono`;

/**
 * Single regex-script editor. Exposes the full SillyTavern regex field set so a
 * script authored here behaves the same as in ST: find/replace, placement,
 * display-vs-prompt pipeline flags, depth gating, trim strings and macro
 * substitution mode. Mirrors WorldInfoRuleModal's form styling.
 */
export function RegexScriptEditModal({
  isOpen,
  onClose,
  onSave,
  initialScript,
}: RegexScriptEditModalProps) {
  const [scriptName, setScriptName] = useState("");
  const [findRegex, setFindRegex] = useState("");
  const [replaceString, setReplaceString] = useState("");
  const [trimText, setTrimText] = useState(""); // one trim string per line
  const [placement, setPlacement] = useState<number[]>([2]);
  const [markdownOnly, setMarkdownOnly] = useState(true);
  const [promptOnly, setPromptOnly] = useState(false);
  const [runOnEdit, setRunOnEdit] = useState(false);
  const [substituteRegex, setSubstituteRegex] = useState<0 | 1 | 2>(0);
  const [minDepth, setMinDepth] = useState("");
  const [maxDepth, setMaxDepth] = useState("");

  useEffect(() => {
    if (initialScript) {
      setScriptName(initialScript.scriptName);
      setFindRegex(initialScript.findRegex);
      setReplaceString(initialScript.replaceString);
      setTrimText((initialScript.trimStrings ?? []).join("\n"));
      setPlacement(initialScript.placement?.length ? initialScript.placement : [2]);
      setMarkdownOnly(initialScript.markdownOnly);
      setPromptOnly(initialScript.promptOnly);
      setRunOnEdit(initialScript.runOnEdit);
      setSubstituteRegex(initialScript.substituteRegex ?? 0);
      setMinDepth(initialScript.minDepth == null ? "" : String(initialScript.minDepth));
      setMaxDepth(initialScript.maxDepth == null ? "" : String(initialScript.maxDepth));
    } else {
      setScriptName("");
      setFindRegex("");
      setReplaceString("");
      setTrimText("");
      setPlacement([2]);
      setMarkdownOnly(true);
      setPromptOnly(false);
      setRunOnEdit(false);
      setSubstituteRegex(0);
      setMinDepth("");
      setMaxDepth("");
    }
  }, [initialScript, isOpen]);

  const togglePlacement = (code: number) => {
    setPlacement((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code].sort((a, b) => a - b),
    );
  };

  const parseDepth = (s: string): number | null => {
    const t = s.trim();
    if (t === "") return null;
    const n = parseInt(t, 10);
    return Number.isFinite(n) ? n : null;
  };

  const canSave = scriptName.trim() !== "" && findRegex.trim() !== "";

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      id: initialScript?.id || `regex-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      scriptName: scriptName.trim(),
      findRegex: findRegex.trim(),
      replaceString,
      trimStrings: trimText
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s !== ""),
      placement: placement.length ? placement : [2],
      disabled: initialScript?.disabled ?? false,
      markdownOnly,
      promptOnly,
      runOnEdit,
      substituteRegex,
      minDepth: parseDepth(minDepth),
      maxDepth: parseDepth(maxDepth),
    });
    onClose();
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={initialScript ? "编辑正则脚本" : "新建正则脚本"}
      titleIcon={<Regex size={16} className="text-blue-600 dark:text-blue-400" />}
      maxWidth="max-w-xl"
      footer={
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-700 dark:text-white rounded-xl text-sm font-medium hover:bg-gray-50 dark:hover:bg-white/10 transition-all"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium transition-all shadow-lg shadow-blue-500/20"
          >
            确认保存
          </button>
        </div>
      }
    >
      <div className="p-6 space-y-5">
        <div>
          <label className={fieldLabel}>脚本名称</label>
          <input
            type="text"
            value={scriptName}
            onChange={(e) => setScriptName(e.target.value)}
            placeholder="例如：去除思维链、替换称呼..."
            className={textInput}
          />
        </div>

        <div>
          <label className={fieldLabel}>查找正则</label>
          <input
            type="text"
            value={findRegex}
            onChange={(e) => setFindRegex(e.target.value)}
            placeholder="/pattern/gi 或裸 pattern"
            className={monoInput}
          />
          <p className="text-[10px] text-gray-500 mt-1.5 px-1 italic">
            支持 <code>/pattern/flags</code> 形式（flags 限 gimsuy），或直接写裸表达式。
          </p>
        </div>

        <div>
          <label className={fieldLabel}>替换为</label>
          <textarea
            value={replaceString}
            onChange={(e) => setReplaceString(e.target.value)}
            placeholder="留空表示删除匹配项。支持 {{match}} $1 $<name> 与 {{宏}}"
            className={`${monoInput} h-24 resize-none`}
          />
        </div>

        <div>
          <label className={fieldLabel}>作用范围</label>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {PLACEMENTS.map((p) => {
              const on = placement.includes(p.code);
              return (
                <button
                  key={p.code}
                  type="button"
                  onClick={() => togglePlacement(p.code)}
                  className={`px-2 py-2 rounded-xl border text-xs font-medium transition-all ${
                    on
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500"
                      : "border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:border-gray-300"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className={fieldLabel}>生效管线</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setMarkdownOnly((v) => !v)}
              className={`px-4 py-3 rounded-2xl border text-sm font-medium transition-all ${
                markdownOnly
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500"
                  : "border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:border-gray-300"
              }`}
            >
              👁 仅显示
            </button>
            <button
              type="button"
              onClick={() => setPromptOnly((v) => !v)}
              className={`px-4 py-3 rounded-2xl border text-sm font-medium transition-all ${
                promptOnly
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500"
                  : "border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:border-gray-300"
              }`}
            >
              ✉ 仅提示词
            </button>
          </div>
          <p className="text-[10px] text-gray-500 mt-1.5 px-1 italic">
            「仅显示」只改渲染的气泡；「仅提示词」只改发给模型的文本；两者皆开 = 都改。
            两者皆关时 NyaaChat 无触发点（不在存盘时跑正则），等于不生效。
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={fieldLabel}>编辑时运行</label>
            <button
              type="button"
              onClick={() => setRunOnEdit((v) => !v)}
              className={`w-full px-4 py-3 rounded-2xl border text-sm font-medium transition-all ${
                runOnEdit
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500"
                  : "border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:border-gray-300"
              }`}
            >
              {runOnEdit ? "开启" : "关闭"}
            </button>
          </div>
          <div>
            <label className={fieldLabel}>宏替换查找式</label>
            <select
              value={substituteRegex}
              onChange={(e) => setSubstituteRegex(Number(e.target.value) as 0 | 1 | 2)}
              className={textInput}
            >
              {SUBSTITUTE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={fieldLabel}>最小深度</label>
            <input
              type="number"
              value={minDepth}
              onChange={(e) => setMinDepth(e.target.value)}
              placeholder="不限"
              className={textInput}
            />
          </div>
          <div>
            <label className={fieldLabel}>最大深度</label>
            <input
              type="number"
              value={maxDepth}
              onChange={(e) => setMaxDepth(e.target.value)}
              placeholder="不限"
              className={textInput}
            />
          </div>
        </div>
        <p className="text-[10px] text-gray-500 -mt-2 px-1 italic">
          深度按倒序索引：0 = 最后一条消息。留空表示不限。
        </p>

        <div>
          <label className={fieldLabel}>修剪字符串（每行一个）</label>
          <textarea
            value={trimText}
            onChange={(e) => setTrimText(e.target.value)}
            placeholder="替换前从匹配中剔除的子串，每行一个"
            className={`${monoInput} h-16 resize-none`}
          />
        </div>
      </div>
    </BaseModal>
  );
}
