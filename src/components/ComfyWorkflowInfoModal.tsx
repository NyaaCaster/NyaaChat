import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import { FileText } from "lucide-react";
import { BaseModal } from "./BaseModal";

interface ComfyWorkflowInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Read-only viewer for public/comfyui/ComfyUI-workflow-info.md, opened from the
 * custom-ComfyUI provider editor. Same markdown-rendering approach as
 * VersionModal, but the content lives under public/ (served statically), so we
 * fetch it lazily on first open instead of inlining it into the bundle.
 *
 * Anchors to /comfyui/* (the bundled workflow/model files) get a `download`
 * attribute so a click saves the file rather than navigating away; all other
 * links open in a new tab.
 */
export function ComfyWorkflowInfoModal({
  isOpen,
  onClose,
}: ComfyWorkflowInfoModalProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!isOpen || content !== null || error) return;
    let cancelled = false;
    fetch("/comfyui/ComfyUI-workflow-info.md")
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.text();
      })
      .then((text) => {
        if (!cancelled) setContent(text);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, content, error]);

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="ComfyUI 工作流配置文档"
      titleIcon={<FileText size={16} className="text-purple-600 dark:text-purple-400" />}
      maxWidth="max-w-2xl"
    >
      <div className="p-5 sm:p-6">
        {error ? (
          <div className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
            文档加载失败。
          </div>
        ) : content === null ? (
          <div className="py-10 text-center text-sm text-gray-400 dark:text-gray-500">
            加载中…
          </div>
        ) : (
          <div className="prose prose-sm md:prose-base max-w-none dark:prose-invert prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-headings:tracking-tight">
            <Markdown
              components={{
                a: ({ href, children }) => {
                  const isLocalAsset = !!href && href.startsWith("/comfyui/");
                  return (
                    <a
                      href={href}
                      target={isLocalAsset ? undefined : "_blank"}
                      rel="noopener noreferrer"
                      download={isLocalAsset ? "" : undefined}
                    >
                      {children}
                    </a>
                  );
                },
              }}
            >
              {content}
            </Markdown>
          </div>
        )}
      </div>
    </BaseModal>
  );
}
