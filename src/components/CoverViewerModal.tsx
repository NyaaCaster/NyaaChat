import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { X } from "lucide-react";
import React from "react";

interface CoverViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  src: string;
  alt?: string;
}

/**
 * Lightweight viewer for a character cover (512×768). Unlike ImageViewerModal
 * (zoom/pan toolbar, built for generated images), this just presents the cover
 * with rounded corners and a close button, matching the spec's image-t.jpg:
 *
 * - PC / wide viewports: native size, 512×768.
 * - Mobile portrait: scaled up to (almost) the screen width, preserving aspect.
 *
 * `min(...)` caps keep it inside the viewport on small or short screens.
 */
export function CoverViewerModal({ isOpen, onClose, src, alt }: CoverViewerModalProps) {
  React.useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[65] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/85 backdrop-blur-md"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10"
      >
        <img
          src={src}
          alt={alt || "角色封面"}
          draggable={false}
          className="rounded-2xl shadow-elevation-3 object-contain"
          style={{
            // Native 512×768 on PC; on narrow/short screens cap to viewport so
            // it scales down (mobile portrait → ~screen width).
            width: "min(512px, 92vw)",
            height: "auto",
            maxHeight: "90vh",
          }}
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="absolute -top-3 -right-3 p-2 rounded-full bg-white/15 hover:bg-white/30 text-white backdrop-blur transition-colors"
        >
          <X size={18} />
        </button>
      </motion.div>
    </div>,
    document.body,
  );
}
