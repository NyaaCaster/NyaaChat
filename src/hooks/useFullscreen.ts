import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Browser fullscreen toggle. Exposes:
 *
 * - isSupported: false on iOS Safari (no requestFullscreen on docElement)
 * - isFullscreen: tracks document.fullscreenElement
 * - toggleFullscreen(): button-driven enter/exit
 *
 * Also wires a one-shot bottom-edge swipe-up gesture that auto-enters
 * fullscreen on touch devices the very first time. Once the user has
 * touched the toggle button OR the auto-trigger has fired, swipe-up
 * stops triggering — the button remains the source of truth from then
 * on. This keeps the discoverability win without becoming a recurring
 * surprise.
 */
export function useFullscreen() {
  const isSupported =
    typeof document !== "undefined" &&
    typeof document.documentElement.requestFullscreen === "function";
  const [isFullscreen, setIsFullscreen] = useState(false);
  const hasAutoTriggeredRef = useRef(false);

  const enterFullscreen = useCallback(async () => {
    if (!isSupported) return;
    try {
      await document.documentElement.requestFullscreen();
      hasAutoTriggeredRef.current = true;
    } catch {
      // user gesture missing, permission denied, etc.
    }
  }, [isSupported]);

  const exitFullscreen = useCallback(async () => {
    if (!document.fullscreenElement) return;
    try {
      await document.exitFullscreen();
    } catch {
      // already exited / not allowed
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    hasAutoTriggeredRef.current = true;
    if (document.fullscreenElement) {
      void exitFullscreen();
    } else {
      void enterFullscreen();
    }
  }, [enterFullscreen, exitFullscreen]);

  useEffect(() => {
    if (!isSupported) return;
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [isSupported]);

  useEffect(() => {
    if (!isSupported) return;
    let startY: number | null = null;
    let startX: number | null = null;
    let startTime = 0;
    const EDGE_PX = 80;
    const MIN_DY = 100;
    const MAX_DX = 60;
    const MAX_DURATION_MS = 600;

    const onTouchStart = (e: TouchEvent) => {
      if (hasAutoTriggeredRef.current) return;
      if (document.fullscreenElement) return;
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientY < window.innerHeight - EDGE_PX) return;
      startY = t.clientY;
      startX = t.clientX;
      startTime = Date.now();
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (startY === null || startX === null) return;
      const t = e.changedTouches[0];
      const dy = t.clientY - startY;
      const dx = t.clientX - startX;
      const elapsed = Date.now() - startTime;
      startY = null;
      startX = null;
      if (hasAutoTriggeredRef.current) return;
      if (document.fullscreenElement) return;
      if (elapsed > MAX_DURATION_MS) return;
      if (Math.abs(dx) > MAX_DX) return;
      if (dy > -MIN_DY) return;
      void enterFullscreen();
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [isSupported, enterFullscreen]);

  return { isSupported, isFullscreen, toggleFullscreen };
}
