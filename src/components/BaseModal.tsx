import React, { useEffect, useId, useRef } from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";

/**
 * Accessible modal shell with ESC-to-close, Tab focus trap, body scroll
 * lock, and aria-labelledby on the heading. The visual layout (header /
 * body / footer slots) matches the look the existing modals already use,
 * so call sites can drop in this component and remove their own backdrop +
 * card wrapper without re-skinning anything.
 */
interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  titleIcon?: React.ReactNode;
  /** Optional control rendered between the title and the close button — e.g.
   *  a master enable/disable toggle that belongs at the same level as the
   *  modal heading rather than inside the body. */
  titleAction?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Tailwind max-width class fragment, e.g. "max-w-lg", "max-w-2xl". */
  maxWidth?: string;
  /** Pass when title is omitted, so screen readers still get a label. */
  ariaLabel?: string;
  closeOnBackdrop?: boolean;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Module-level stack of currently open modals' close handlers. Lets ESC
// close only the topmost modal when several are nested (e.g.
// CharacterSelection -> CharacterEdit -> WorldInfoRule). Without this,
// every BaseModal's document-level keydown listener fires for the same
// keypress and they'd all close at once.
const modalStack: Array<() => void> = [];

export function BaseModal({
  isOpen,
  onClose,
  title,
  titleIcon,
  titleAction,
  children,
  footer,
  maxWidth = "max-w-lg",
  ariaLabel,
  closeOnBackdrop = true,
}: BaseModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modalStack.push(onClose);

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Only react when this is the topmost modal on the stack — nested
        // modals would otherwise all close from a single ESC.
        if (modalStack[modalStack.length - 1] !== onClose) return;
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKey);

    // Auto-focus a sensible target after the open animation kicks off.
    // Prefer the first text input; fall back to the first focusable. Skip
    // when the dialog already contains the active element (e.g. when a
    // descendant set autoFocus).
    const t = setTimeout(() => {
      if (!dialogRef.current) return;
      if (dialogRef.current.contains(document.activeElement)) return;
      const target =
        dialogRef.current.querySelector<HTMLElement>('[data-autofocus]') ||
        dialogRef.current.querySelector<HTMLElement>('input:not([type="hidden"]), textarea') ||
        dialogRef.current.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      target?.focus();
    }, 50);

    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = prevOverflow;
      const idx = modalStack.indexOf(onClose);
      if (idx >= 0) modalStack.splice(idx, 1);
      clearTimeout(t);
      // Restore focus to the trigger so keyboard users don't get lost.
      previouslyFocused?.focus?.();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
        onClick={closeOnBackdrop ? onClose : undefined}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? ariaLabel : undefined}
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className={`relative w-full ${maxWidth} bg-white/95 dark:bg-[#111111]/95 backdrop-blur-xl rounded-2xl shadow-elevation-3 border border-gray-200/50 dark:border-white/10 max-h-[90vh] flex flex-col overflow-hidden`}
      >
        {title && (
          <div className="flex items-center justify-between p-4 sm:p-5 border-b border-gray-100 dark:border-white/5 flex-shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              {titleIcon && (
                <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                  {titleIcon}
                </div>
              )}
              <h3
                id={titleId}
                className="text-lg font-semibold tracking-tight truncate"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {title}
              </h3>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {titleAction}
              <button
                onClick={onClose}
                aria-label="关闭"
                className="p-2 text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-white/10 rounded-xl transition-all"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        )}
        <div className="overflow-y-auto flex-1 min-h-0">{children}</div>
        {footer && (
          <div className="p-4 sm:p-5 border-t border-gray-100 dark:border-white/5 bg-gray-50/50 dark:bg-black/20 flex-shrink-0">
            {footer}
          </div>
        )}
      </motion.div>
    </div>
  );
}
