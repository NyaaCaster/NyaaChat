import React from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";

// Target cover dimensions. The crop box is locked to this aspect ratio and the
// output canvas is exactly this size, so every cover is a uniform 512×768.
const OUT_W = 512;
const OUT_H = 768;
const ASPECT = OUT_W / OUT_H; // width / height = 2 / 3

interface ImageCropModalProps {
  isOpen: boolean;
  /** Source image as an object URL (created by the caller from the picked File). */
  src: string | null;
  onCancel: () => void;
  /** Receives the cropped 512×768 WebP blob. */
  onCrop: (blob: Blob) => void;
}

type Corner = "nw" | "ne" | "sw" | "se";

/**
 * Cover-image cropper. Shows the picked image fitted into the viewport with a
 * draggable, corner-resizable crop rectangle locked to the 512:768 aspect. On
 * confirm it draws the selected source region onto a 512×768 canvas and exports
 * WebP — re-encoding strips every original metadata/tEXt chunk, so the saved
 * cover is pure pixels (no character JSON ever rides along, per the spec).
 */
export function ImageCropModal({ isOpen, src, onCancel, onCrop }: ImageCropModalProps) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [natural, setNatural] = React.useState<{ w: number; h: number } | null>(null);
  // Displayed image size (fitted into the available box).
  const [disp, setDisp] = React.useState<{ w: number; h: number }>({ w: 0, h: 0 });
  // Crop rect in DISPLAYED image pixels, relative to the image top-left.
  const [crop, setCrop] = React.useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Drag bookkeeping. `mode` distinguishes moving the whole box from resizing
  // via a specific corner; the start refs snapshot pointer + crop at grab time.
  const dragRef = React.useRef<{
    mode: "move" | Corner;
    startX: number;
    startY: number;
    startCrop: { x: number; y: number; w: number; h: number };
  } | null>(null);

  // Reset everything when a new source comes in.
  React.useEffect(() => {
    setNatural(null);
    setCrop(null);
  }, [src]);

  const computeDisp = React.useCallback(() => {
    if (!natural) return;
    const maxW = Math.min(window.innerWidth * 0.9, 560);
    const maxH = Math.min(window.innerHeight * 0.72, 680);
    const fit = Math.min(maxW / natural.w, maxH / natural.h);
    const w = Math.round(natural.w * fit);
    const h = Math.round(natural.h * fit);
    setDisp({ w, h });
    // Largest 2:3 box that fits the displayed image, centered.
    let cw = w;
    let ch = cw / ASPECT;
    if (ch > h) {
      ch = h;
      cw = ch * ASPECT;
    }
    setCrop({ x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch });
  }, [natural]);

  React.useEffect(() => {
    if (!isOpen || !natural) return;
    computeDisp();
    const onResize = () => computeDisp();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isOpen, natural, computeDisp]);

  // Lock body scroll + ESC to cancel.
  React.useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [isOpen, onCancel]);

  const clampCrop = React.useCallback(
    (c: { x: number; y: number; w: number; h: number }) => {
      const x = Math.max(0, Math.min(c.x, disp.w - c.w));
      const y = Math.max(0, Math.min(c.y, disp.h - c.h));
      return { ...c, x, y };
    },
    [disp.w, disp.h],
  );

  const onPointerDownBox = (e: React.PointerEvent, mode: "move" | Corner) => {
    e.preventDefault();
    e.stopPropagation();
    if (!crop) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, startCrop: { ...crop } };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !crop) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;

    if (d.mode === "move") {
      setCrop(clampCrop({ ...d.startCrop, x: d.startCrop.x + dx, y: d.startCrop.y + dy }));
      return;
    }

    // Resize from a corner. Keep the OPPOSITE corner anchored and maintain the
    // fixed aspect ratio; the dominant pointer axis (dx) drives the new width.
    const s = d.startCrop;
    const minW = 40;
    // Anchor = the corner diagonally opposite the dragged one.
    const anchorX = d.mode === "nw" || d.mode === "sw" ? s.x + s.w : s.x;
    const anchorY = d.mode === "nw" || d.mode === "ne" ? s.y + s.h : s.y;
    const dirX = d.mode === "ne" || d.mode === "se" ? 1 : -1;

    let newW = Math.max(minW, s.w + dirX * dx);
    // Cap width so the box (anchored at anchorX) stays within the image.
    const maxWByX = dirX === 1 ? disp.w - anchorX : anchorX;
    newW = Math.min(newW, maxWByX);
    let newH = newW / ASPECT;
    // Cap height against the vertical anchor, then re-derive width to keep AR.
    const dirYDown = d.mode === "nw" || d.mode === "ne" ? false : true;
    const maxHByY = dirYDown ? disp.h - anchorY : anchorY;
    if (newH > maxHByY) {
      newH = maxHByY;
      newW = newH * ASPECT;
    }
    const newX = dirX === 1 ? anchorX : anchorX - newW;
    const newY = dirYDown ? anchorY : anchorY - newH;
    setCrop({ x: newX, y: newY, w: newW, h: newH });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
  };

  const handleConfirm = () => {
    if (!src || !natural || !crop) return;
    const scale = natural.w / disp.w; // displayed → natural
    const sx = crop.x * scale;
    const sy = crop.y * scale;
    const sw = crop.w * scale;
    const sh = crop.h * scale;

    const canvas = document.createElement("canvas");
    canvas.width = OUT_W;
    canvas.height = OUT_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OUT_W, OUT_H);
      canvas.toBlob(
        (blob) => {
          if (blob) onCrop(blob);
        },
        "image/webp",
        0.9,
      );
    };
    img.src = src;
  };

  if (!isOpen || !src) return null;

  const handleSize = 16;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
        onClick={onCancel}
        className="absolute inset-0 bg-black/85 backdrop-blur-md"
      />

      <div className="relative z-10 flex flex-col items-center gap-4 px-4">
        <p className="text-white/90 text-sm font-medium select-none">调整封面裁剪范围（512 × 768）</p>

        <div
          ref={wrapRef}
          className="relative touch-none select-none"
          style={{ width: disp.w || undefined, height: disp.h || undefined }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <img
            src={src}
            alt="待裁剪"
            draggable={false}
            onLoad={(e) => {
              const el = e.currentTarget;
              setNatural({ w: el.naturalWidth, h: el.naturalHeight });
            }}
            className="block rounded-lg"
            style={{ width: disp.w || "auto", height: disp.h || "auto", maxWidth: "none" }}
          />

          {crop && (
            <>
              {/* Dimmed overlay outside the crop box (4 bands). */}
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute left-0 right-0 top-0 bg-black/55" style={{ height: crop.y }} />
                <div
                  className="absolute left-0 right-0 bg-black/55"
                  style={{ top: crop.y + crop.h, bottom: 0 }}
                />
                <div
                  className="absolute left-0 bg-black/55"
                  style={{ top: crop.y, height: crop.h, width: crop.x }}
                />
                <div
                  className="absolute right-0 bg-black/55"
                  style={{ top: crop.y, height: crop.h, left: crop.x + crop.w }}
                />
              </div>

              {/* Crop box. */}
              <div
                className="absolute border-2 border-blue-400 cursor-move"
                style={{ left: crop.x, top: crop.y, width: crop.w, height: crop.h }}
                onPointerDown={(e) => onPointerDownBox(e, "move")}
              >
                {/* Rule-of-thirds guides */}
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute top-1/3 left-0 right-0 border-t border-white/30" />
                  <div className="absolute top-2/3 left-0 right-0 border-t border-white/30" />
                  <div className="absolute left-1/3 top-0 bottom-0 border-l border-white/30" />
                  <div className="absolute left-2/3 top-0 bottom-0 border-l border-white/30" />
                </div>
                {/* Corner handles */}
                {(["nw", "ne", "sw", "se"] as Corner[]).map((corner) => {
                  const style: React.CSSProperties = {
                    width: handleSize,
                    height: handleSize,
                    position: "absolute",
                    ...(corner.includes("n") ? { top: -handleSize / 2 } : { bottom: -handleSize / 2 }),
                    ...(corner.includes("w") ? { left: -handleSize / 2 } : { right: -handleSize / 2 }),
                    cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize",
                  };
                  return (
                    <div
                      key={corner}
                      style={style}
                      className="bg-blue-400 rounded-sm border border-white"
                      onPointerDown={(e) => onPointerDownBox(e, corner)}
                    />
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleConfirm}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors"
          >
            裁剪
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-6 py-2 bg-white/10 hover:bg-white/20 text-white text-sm font-medium rounded-xl transition-colors"
          >
            取消
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
