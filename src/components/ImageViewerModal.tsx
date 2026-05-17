import React from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { X, ZoomIn, ZoomOut, Square, Download } from "lucide-react";
import { downloadImage } from "../lib/imageApi";

interface ImageViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  src: string;
  filename?: string;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.25;

/**
 * Full-screen image viewer with pinch-zoom and pan.
 *
 * - Initial state fits the image inside the viewport at native aspect.
 * - Mouse wheel + Ctrl zooms; trackpad pinch (ctrlKey on wheel) zooms;
 *   touch two-finger pinch zooms; one-finger drag pans.
 * - 1:1 button restores native pixel scale; magnify/shrink buttons step by 25%.
 */
export function ImageViewerModal({ isOpen, onClose, src, filename }: ImageViewerModalProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const imgRef = React.useRef<HTMLImageElement>(null);
  const [natural, setNatural] = React.useState<{ w: number; h: number } | null>(null);
  const [scale, setScale] = React.useState(1);
  const [translate, setTranslate] = React.useState({ x: 0, y: 0 });

  const baseScaleRef = React.useRef(1);
  const isPanningRef = React.useRef(false);
  const lastPointRef = React.useRef<{ x: number; y: number } | null>(null);
  const pinchStateRef = React.useRef<{
    startDistance: number;
    startScale: number;
    centerX: number;
    centerY: number;
  } | null>(null);
  const activePointersRef = React.useRef<Map<number, { x: number; y: number }>>(new Map());

  // ESC closes; lock body scroll while open.
  React.useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, onClose]);

  const recomputeFit = React.useCallback(() => {
    const container = containerRef.current;
    if (!container || !natural) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (cw === 0 || ch === 0) return;
    const fit = Math.min(cw / natural.w, ch / natural.h, 1);
    baseScaleRef.current = fit;
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, [natural]);

  React.useEffect(() => {
    if (!isOpen) return;
    recomputeFit();
    const onResize = () => recomputeFit();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isOpen, recomputeFit]);

  // Reset on src change so opening a different image starts fitted.
  React.useEffect(() => {
    setNatural(null);
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, [src]);

  const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

  const handleImgLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    setNatural({ w: img.naturalWidth, h: img.naturalHeight });
  };

  const zoomBy = (factor: number, anchorX?: number, anchorY?: number) => {
    setScale((prev) => {
      const next = clampScale(prev * factor);
      if (next === prev) return prev;
      // Keep the anchor point under the cursor stable: shift translate so the
      // pixel under (anchorX, anchorY) stays put after scaling.
      if (anchorX != null && anchorY != null) {
        const container = containerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          const cx = anchorX - rect.left - rect.width / 2;
          const cy = anchorY - rect.top - rect.height / 2;
          setTranslate((t) => ({
            x: cx - ((cx - t.x) * next) / prev,
            y: cy - ((cy - t.y) * next) / prev,
          }));
        }
      }
      return next;
    });
  };

  const handleZoomIn = () => zoomBy(ZOOM_STEP);
  const handleZoomOut = () => zoomBy(1 / ZOOM_STEP);
  const handleActualSize = () => {
    // Set the user-scale so that base * scale === 1 (one image pixel per CSS pixel).
    const base = baseScaleRef.current || 1;
    setScale(clampScale(1 / base));
    setTranslate({ x: 0, y: 0 });
  };
  const handleDownload = () => {
    void downloadImage(src, filename || "image");
  };

  const handleWheel: React.WheelEventHandler<HTMLDivElement> = (e) => {
    // Pinch on macOS trackpad surfaces as ctrlKey; mouse wheel works the same.
    e.preventDefault();
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    zoomBy(factor, e.clientX, e.clientY);
  };

  const handlePointerDown: React.PointerEventHandler<HTMLDivElement> = (e) => {
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.target as Element).setPointerCapture?.(e.pointerId);

    if (activePointersRef.current.size === 2) {
      const pts = Array.from(activePointersRef.current.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      pinchStateRef.current = {
        startDistance: Math.hypot(dx, dy),
        startScale: scale,
        centerX: (pts[0].x + pts[1].x) / 2,
        centerY: (pts[0].y + pts[1].y) / 2,
      };
      isPanningRef.current = false;
    } else {
      isPanningRef.current = true;
      lastPointRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handlePointerMove: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (!activePointersRef.current.has(e.pointerId)) return;
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointersRef.current.size >= 2 && pinchStateRef.current) {
      const pts = Array.from(activePointersRef.current.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const distance = Math.hypot(dx, dy);
      const start = pinchStateRef.current;
      const nextScale = clampScale((start.startScale * distance) / Math.max(1, start.startDistance));
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const cx = start.centerX - rect.left - rect.width / 2;
      const cy = start.centerY - rect.top - rect.height / 2;
      setScale((prev) => {
        if (nextScale === prev) return prev;
        setTranslate((t) => ({
          x: cx - ((cx - t.x) * nextScale) / prev,
          y: cy - ((cy - t.y) * nextScale) / prev,
        }));
        return nextScale;
      });
      return;
    }

    if (isPanningRef.current && lastPointRef.current) {
      const dx = e.clientX - lastPointRef.current.x;
      const dy = e.clientY - lastPointRef.current.y;
      lastPointRef.current = { x: e.clientX, y: e.clientY };
      setTranslate((t) => ({ x: t.x + dx, y: t.y + dy }));
    }
  };

  const endPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.delete(e.pointerId);
    if (activePointersRef.current.size < 2) pinchStateRef.current = null;
    if (activePointersRef.current.size === 0) {
      isPanningRef.current = false;
      lastPointRef.current = null;
    }
  };

  if (!isOpen) return null;

  const effectiveScale = baseScaleRef.current * scale;

  // Render via portal at document.body so the viewer escapes the chat
  // <main className="z-10 relative"> stacking context. Without this, the
  // composer (rendered after <main> in the DOM) ends up painted over the
  // viewer's bottom toolbar regardless of how high its internal z-index is.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/85 backdrop-blur-md"
      />

      <div
        ref={containerRef}
        className="relative w-full h-full flex items-center justify-center overflow-hidden touch-none select-none"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={endPointer}
        style={{ cursor: isPanningRef.current ? "grabbing" : "grab" }}
      >
        <img
          ref={imgRef}
          src={src}
          alt="预览"
          draggable={false}
          onLoad={handleImgLoad}
          className="will-change-transform"
          style={{
            transform: `translate3d(${translate.x}px, ${translate.y}px, 0) scale(${effectiveScale})`,
            transformOrigin: "center center",
            transition: isPanningRef.current || pinchStateRef.current ? "none" : "transform 0.15s ease-out",
            maxWidth: "none",
            maxHeight: "none",
            visibility: natural ? "visible" : "hidden",
          }}
        />
      </div>

      {/* Top-right close */}
      <button
        type="button"
        onClick={onClose}
        aria-label="关闭"
        className="absolute top-4 right-4 z-10 p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur transition-colors"
      >
        <X size={20} />
      </button>

      {/* Bottom toolbar */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 px-2 py-1.5 rounded-full bg-black/60 backdrop-blur border border-white/10 text-white shadow-elevation-3">
        <ToolbarButton onClick={handleZoomOut} title="缩小">
          <ZoomOut size={18} />
        </ToolbarButton>
        <ToolbarButton onClick={handleActualSize} title="原始尺寸 1:1">
          <Square size={16} />
          <span className="text-[11px] font-semibold ml-1">1:1</span>
        </ToolbarButton>
        <ToolbarButton onClick={handleZoomIn} title="放大">
          <ZoomIn size={18} />
        </ToolbarButton>
        <div className="w-px h-5 bg-white/20 mx-1" />
        <ToolbarButton onClick={handleDownload} title="下载图片">
          <Download size={18} />
        </ToolbarButton>
        <ToolbarButton onClick={onClose} title="关闭">
          <X size={18} />
        </ToolbarButton>
        <span className="ml-2 mr-2 text-[11px] tabular-nums opacity-80">
          {Math.round(effectiveScale * 100)}%
        </span>
      </div>
    </div>,
    document.body,
  );
}

function ToolbarButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex items-center px-3 py-2 rounded-full hover:bg-white/15 active:bg-white/25 transition-colors"
    >
      {children}
    </button>
  );
}
