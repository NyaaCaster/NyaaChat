import Markdown from "react-markdown";
import { Tag } from "lucide-react";
import { BaseModal } from "./BaseModal";
// VERSION.md is the single source of truth for version content. Vite's ?raw
// suffix inlines its text at build time, so the modal renders the exact same
// file the build reads the version number from — no double maintenance, no
// runtime fetch (VERSION.md is not shipped into the nginx html dir).
import versionRaw from "@/VERSION.md?raw";

interface VersionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Read-only modal that renders VERSION.md (current version notes) as markdown.
 * Opened from the version badge next to the app title in ChatHeader.
 */
export function VersionModal({ isOpen, onClose }: VersionModalProps) {
  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="版本信息"
      titleIcon={<Tag size={16} className="text-blue-500" />}
      maxWidth="max-w-2xl"
    >
      <div className="p-5 sm:p-6">
        <div className="prose prose-sm md:prose-base max-w-none dark:prose-invert prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-headings:tracking-tight">
          <Markdown
            components={{
              // Open links (commit URL, CHANGELOG, repo) in a new tab so they
              // never navigate away from the running app.
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              ),
            }}
          >
            {versionRaw}
          </Markdown>
        </div>
      </div>
    </BaseModal>
  );
}
