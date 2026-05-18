import React from "react";

interface CustomProviderIconProps {
  size?: number;
  className?: string;
}

/**
 * Mark used for the "custom" LLM provider kind — a chat bubble with three
 * dots, in the project's blue accent. Replaces the previous wrench glyph
 * which read as "settings/repair" rather than "this is a chat endpoint
 * the user defined".
 *
 * The gradient id is suffixed with `useId` so multiple icon instances on
 * the same page each reference their own `<linearGradient>` — without
 * this, the second mount silently renders unfilled because its referenced
 * gradient already detached when the first instance unmounted.
 */
export function CustomProviderIcon({ size = 18, className }: CustomProviderIconProps) {
  const reactId = React.useId();
  const gradientId = `custom-bubble-${reactId.replace(/:/g, "")}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="0"
          y1="3"
          x2="0"
          y2="21"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#3B82F6" />
          <stop offset="1" stopColor="#2563EB" />
        </linearGradient>
      </defs>
      {/* Bubble body + tail merged into a single path so the fill is
          continuous (no seam between rectangle and tail). */}
      <path
        d="M5 4 H19 A3 3 0 0 1 22 7 V14 A3 3 0 0 1 19 17 H10 L6.5 20.5 V17 H5 A3 3 0 0 1 2 14 V7 A3 3 0 0 1 5 4 Z"
        fill={`url(#${gradientId})`}
      />
      {/* Three dots indicating "message content". White at full opacity
          reads cleanly against the blue body in both light and dark mode. */}
      <circle cx="8" cy="10.5" r="1.3" fill="#FFFFFF" />
      <circle cx="12" cy="10.5" r="1.3" fill="#FFFFFF" />
      <circle cx="16" cy="10.5" r="1.3" fill="#FFFFFF" />
    </svg>
  );
}
