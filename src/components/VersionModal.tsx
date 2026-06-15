import { useState } from "react";
import Markdown from "react-markdown";
import { Tag, History } from "lucide-react";
import { BaseModal } from "./BaseModal";
// VERSION.md is the single source of truth for the *current* version content.
// Vite's ?raw suffix inlines its text at build time, so the modal renders the
// exact same file the build reads the version number from — no double
// maintenance, no runtime fetch (VERSION.md is not shipped into the nginx html
// dir). CHANGELOG.md (the full history) is loaded lazily on first tab open so
// it never weighs on the initial render of the current-version view.
import versionRaw from "@/VERSION.md?raw";

interface VersionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type VersionTab = "current" | "history";

// Shared markdown renderer: links always open in a new tab so they never
// navigate away from the running app.
function VersionMarkdown({ children }: { children: string }) {
  return (
    <div className="prose prose-sm md:prose-base max-w-none dark:prose-invert prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-headings:tracking-tight">
      <Markdown
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}

/**
 * Read-only modal with two tabs: the current version (VERSION.md) shown by
 * default, and the full history (CHANGELOG.md) rendered only once the user
 * opens the history tab. Opened from the version badge next to the app title
 * in ChatHeader.
 */
export function VersionModal({ isOpen, onClose }: VersionModalProps) {
  const [tab, setTab] = useState<VersionTab>("current");
  // CHANGELOG.md content, loaded lazily the first time the history tab opens.
  // null = not yet loaded; "" after a load failure renders a fallback message.
  const [changelog, setChangelog] = useState<string | null>(null);
  const [changelogError, setChangelogError] = useState(false);

  const handleOpenHistory = () => {
    setTab("history");
    if (changelog === null && !changelogError) {
      // Dynamic ?raw import keeps CHANGELOG.md out of the bundle path that
      // renders the current-version view; it's fetched only on demand here.
      import("@/CHANGELOG.md?raw")
        .then((mod) => setChangelog(mod.default))
        .catch(() => setChangelogError(true));
    }
  };

  const tabButton = (id: VersionTab, label: string, onSelect: () => void) => {
    const active = tab === id;
    return (
      <button
        type="button"
        onClick={onSelect}
        className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
          active
            ? "border-blue-500 text-blue-600 dark:text-blue-400"
            : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="版本信息"
      titleIcon={<Tag size={16} className="text-blue-500" />}
      maxWidth="max-w-2xl"
    >
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-5 sm:px-6 border-b border-gray-100 dark:border-white/5">
        {tabButton("current", "当前版本", () => setTab("current"))}
        {tabButton("history", "历史版本", handleOpenHistory)}
      </div>

      <div className="p-5 sm:p-6">
        {tab === "current" ? (
          <VersionMarkdown>{versionRaw}</VersionMarkdown>
        ) : changelogError ? (
          <div className="flex flex-col items-center gap-2 py-10 text-gray-500 dark:text-gray-400 text-sm">
            <History size={20} />
            <span>历史版本加载失败。</span>
          </div>
        ) : changelog === null ? (
          <div className="flex items-center justify-center py-10 text-gray-400 dark:text-gray-500 text-sm">
            加载中…
          </div>
        ) : (
          <VersionMarkdown>{changelog}</VersionMarkdown>
        )}
      </div>
    </BaseModal>
  );
}
