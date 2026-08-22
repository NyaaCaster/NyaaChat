import React, { useCallback, useEffect, useState } from "react";
import { Settings, ExternalLink, CheckCircle, XCircle, Loader2, AlertTriangle } from "lucide-react";
import { BaseModal } from "./BaseModal";
import { ApiKeyInput } from "./ApiKeyInput";
import {
  getEmbeddingConfig,
  saveEmbeddingConfig,
  healthCheckEmbedding,
} from "../lib/knowledgeApi";

interface EmbeddingConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: string;
  onSaved?: () => void;
}

const DEFAULT_MODEL = "Qwen/Qwen3-Embedding-8B";
const SILICONFLOW_URL = "https://cloud.siliconflow.cn/i/KJ0qgMuR";

export function EmbeddingConfigModal({
  isOpen,
  onClose,
  token,
  onSaved,
}: EmbeddingConfigModalProps) {
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [originalModel, setOriginalModel] = useState("");
  const [apiKeyWasSet, setApiKeyWasSet] = useState(false);
  const [healthStatus, setHealthStatus] = useState<"idle" | "checking" | "pass" | "fail">("idle");
  const [healthDim, setHealthDim] = useState<number | null>(null);
  const [healthError, setHealthError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const dirtyRef = React.useRef(false);

  const flash = (kind: "ok" | "err", text: string) => {
    setNotice({ kind, text });
    setTimeout(() => setNotice(null), 3000);
  };

  // load existing config on open
  useEffect(() => {
    if (!isOpen) return;
    setHealthStatus("idle");
    setHealthDim(null);
    setHealthError("");
    setNotice(null);
    dirtyRef.current = false;

    (async () => {
      const res = await getEmbeddingConfig(token);
      if (res.kind === "ok") {
        const cfg = res.data;
        if (cfg.base_url) setBaseUrl(cfg.base_url);
        if (cfg.model) {
          setModel(cfg.model);
          setOriginalModel(cfg.model);
        }
        setApiKeyWasSet(!!cfg.api_key_set);
        // apiKey is never returned; leave input blank
        setApiKey("");
        // If there's a saved config that was previously working,
        // we don't auto health-check but we do allow save if nothing changed.
        if (cfg.configured) {
          setHealthStatus("pass"); // treat existing working config as pass
        }
      }
    })();
  }, [isOpen, token]);

  const handleHealthCheck = useCallback(async () => {
    setHealthStatus("checking");
    setHealthError("");
    setHealthDim(null);
    // Save config first so the server has the latest credentials for the check.
    if (baseUrl.trim() && model.trim()) {
      await saveEmbeddingConfig(token, {
        base_url: baseUrl.trim(),
        api_key: apiKey.trim(),
        model: model.trim(),
      });
    }
    const res = await healthCheckEmbedding(token);
    if (res.kind === "ok") {
      setHealthStatus("pass");
      setHealthDim(res.data.dim);
      flash("ok", `健康检查通过，维度: ${res.data.dim}`);
    } else {
      setHealthStatus("fail");
      const msg =
        res.kind === "network"
          ? "服务器无法连接，请检查 API Base URL"
          : res.error || "健康检查失败";
      setHealthError(msg);
    }
  }, [token, baseUrl, model, apiKey]);

  const handleSave = useCallback(async () => {
    if (!baseUrl.trim() || !model.trim() || healthStatus !== "pass") return;
    setSaving(true);
    const res = await saveEmbeddingConfig(token, {
      base_url: baseUrl.trim(),
      api_key: apiKey.trim(),
      model: model.trim(),
    });
    setSaving(false);
    if (res.kind === "ok") {
      setOriginalModel(model);
      setApiKeyWasSet(true);
      setApiKey("");
      dirtyRef.current = false;
      flash("ok", "嵌入模型配置已保存");
      onSaved?.();
      onClose();
    } else {
      const msg =
        res.kind === "network" ? "服务器无法连接" : res.error || "保存失败";
      flash("err", msg);
    }
  }, [token, baseUrl, model, apiKey, healthStatus, onSaved, onClose]);

  // auto-save on close if dirty
  const handleClose = useCallback(async () => {
    if (dirtyRef.current && baseUrl.trim() && model.trim()) {
      await saveEmbeddingConfig(token, {
        base_url: baseUrl.trim(),
        api_key: apiKey.trim(),
        model: model.trim(),
      });
    }
    onClose();
  }, [onClose, token, baseUrl, model, apiKey]);

  const modelChanged = originalModel && model !== originalModel;
  const canSave = healthStatus === "pass" && baseUrl.trim() && model.trim();

  const inputCls =
    "w-full px-3 py-2 text-sm bg-transparent border border-gray-200 dark:border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow";

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      title="嵌入模型配置"
      titleIcon={<Settings size={16} className="text-blue-600 dark:text-blue-400" />}
      maxWidth="max-w-md"
      footer={
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={handleHealthCheck}
            disabled={healthStatus === "checking" || !baseUrl.trim() || !model.trim()}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {healthStatus === "checking" ? (
              <Loader2 size={16} className="animate-spin" />
            ) : healthStatus === "pass" ? (
              <CheckCircle size={16} className="text-green-500" />
            ) : healthStatus === "fail" ? (
              <XCircle size={16} className="text-red-500" />
            ) : null}
            健康检查
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-glow"
          >
            {saving && <Loader2 size={16} className="animate-spin" />}
            保存设置
          </button>
        </div>
      }
    >
      <div className="p-4 sm:p-5 space-y-4">
        {notice && (
          <div
            className={`text-sm rounded-xl px-3 py-2 border ${
              notice.kind === "ok"
                ? "text-green-600 dark:text-green-400 bg-green-500/10 border-green-500/20"
                : "text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/20"
            }`}
          >
            {notice.text}
          </div>
        )}

        {/* baseUrl */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">
            API Base URL
          </label>
          <input
            type="text"
            className={inputCls}
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              dirtyRef.current = true;
              setHealthStatus("idle");
            }}
            placeholder="https://api.siliconflow.cn/v1"
          />
        </div>

        {/* apiKey */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              API Key
            </label>
            <button
              type="button"
              onClick={() => window.open(SILICONFLOW_URL, "_blank")}
              className="inline-flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
            >
              获取嵌入模型 <ExternalLink size={12} />
            </button>
          </div>
          {apiKeyWasSet && !apiKey ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400 dark:text-gray-500">
                已设置（留空保持不变）
              </span>
              <button
                type="button"
                onClick={() => setApiKeyWasSet(false)}
                className="text-xs text-blue-500 hover:text-blue-600 transition-colors"
              >
                修改
              </button>
            </div>
          ) : (
            <ApiKeyInput
              value={apiKey}
              onChange={(v) => {
                setApiKey(v);
                dirtyRef.current = true;
                setHealthStatus("idle");
              }}
              placeholder="输入 API Key"
            />
          )}
        </div>

        {/* model */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">
            模型名称
          </label>
          <input
            type="text"
            className={inputCls}
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              dirtyRef.current = true;
              setHealthStatus("idle");
            }}
            placeholder={DEFAULT_MODEL}
          />
        </div>

        {/* model change warning */}
        {modelChanged && (
          <div className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
            <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
            <span>更换嵌入模型将使已有知识库的向量失效，需要重新处理所有文档。</span>
          </div>
        )}

        {/* health check result */}
        {healthStatus === "fail" && healthError && (
          <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
            <XCircle size={15} className="mt-0.5 flex-shrink-0" />
            <span>{healthError}</span>
          </div>
        )}
        {healthStatus === "pass" && healthDim != null && (
          <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
            检测到嵌入维度: {healthDim}
          </div>
        )}

        {/* save gate hint */}
        {healthStatus !== "pass" && (
          <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
            请先通过健康检查，方可保存设置
          </p>
        )}
      </div>
    </BaseModal>
  );
}
