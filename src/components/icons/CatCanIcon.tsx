import React from "react";

interface CatCanIconProps {
  /** Rendered square size in px. Tuned to read well at both 25 and 256. */
  size?: number;
  className?: string;
  title?: string;
}

/**
 * Colorful cat-food tin — the mark for the shared-character account system
 * (catfood currency). A glossy cylindrical can with a pull-tab lid and a label
 * carrying a cat silhouette + paw, so it stays legible from a 25px header
 * button up to a 256px modal hero.
 *
 * All gradient ids are suffixed with useId so multiple instances on one page
 * each reference their own <linearGradient>; otherwise a later mount finds an
 * earlier instance's id detached from the DOM and renders unfilled.
 */
export function CatCanIcon({ size = 24, className, title }: CatCanIconProps) {
  const rid = React.useId().replace(/:/g, "");
  const metalShineId = `catcan-metalshine-${rid}`;
  const metalDarkId = `catcan-metaldark-${rid}`;
  const labelOrangeId = `catcan-labelorange-${rid}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label={title ?? "猫罐头"}
      className={className}
    >
      <defs>
        {/* 银色金属渐变（用于盖子和边缘） */}
        <linearGradient id={metalShineId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#94A3B8" />
          <stop offset="0.2" stopColor="#E2E8F0" />
          <stop offset="0.4" stopColor="#F8FAFC" />
          <stop offset="0.7" stopColor="#CBD5E1" />
          <stop offset="1" stopColor="#475569" />
        </linearGradient>

        {/* 罐内凹陷阴影渐变 */}
        <linearGradient id={metalDarkId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#475569" />
          <stop offset="0.5" stopColor="#64748B" />
          <stop offset="1" stopColor="#334155" />
        </linearGradient>

        {/* 标签的 3D 弧形渐变（暖橙色系） */}
        <linearGradient id={labelOrangeId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#9A3412" />
          <stop offset="0.2" stopColor="#EA580C" />
          <stop offset="0.5" stopColor="#FDBA74" />
          <stop offset="0.8" stopColor="#EA580C" />
          <stop offset="1" stopColor="#9A3412" />
        </linearGradient>
      </defs>

      {/* 1. 罐体金属基底 */}
      <path d="M 8,20 L 8,46 A 24,8 0 0,0 56,46 L 56,20 A 24,8 0 0,0 8,20 Z" fill={`url(#${metalShineId})`} />

      {/* 2. 底部金属包边 */}
      <path d="M 8,43 L 8,46 A 24,8 0 0,0 56,46 L 56,43 A 24,8 0 0,1 8,43 Z" fill="#475569" opacity="0.4" />
      <path d="M 8,45 L 8,46 A 24,8 0 0,0 56,46 L 56,45 A 24,8 0 0,1 8,45 Z" fill="#F8FAFC" opacity="0.6" />

      {/* 3. 纸质标签（暖橙色） */}
      <path d="M 8,26 L 8,41 A 24,8 0 0,0 56,41 L 56,26 A 24,8 0 0,0 8,26 Z" fill={`url(#${labelOrangeId})`} />

      {/* 标签整体左侧暗部，增加3D立体感 */}
      <path d="M 8,26 L 8,41 A 24,8 0 0,0 16,43 L 16,28 A 24,8 0 0,1 8,26 Z" fill="#000000" opacity="0.15" />

      {/* 4. 标签上的图案设计 */}
      {/* [左侧] 萌系猫咪头像 */}
      <g id="label-cat">
        {/* 猫耳 */}
        <polygon points="19,33 17,27 22,31" fill="#FFFFFF" />
        <polygon points="27,33 29,27 24,31" fill="#FFFFFF" />
        {/* 猫脸 */}
        <ellipse cx="23" cy="35" rx="5" ry="4" fill="#FFFFFF" />
        {/* 眯眼笑（深暖褐色线条） */}
        <path d="M 20,35 Q 21,36 22,35" stroke="#7C2D12" strokeWidth="0.8" strokeLinecap="round" fill="none" />
        <path d="M 24,35 Q 25,36 26,35" stroke="#7C2D12" strokeWidth="0.8" strokeLinecap="round" fill="none" />
      </g>

      {/* [右侧] 经典鱼骨图案 */}
      <g id="label-fishbone">
        <line x1="34" y1="35" x2="44" y2="35" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" />
        <polygon points="34,35 37,32 37,38" fill="#FFFFFF" />
        <line x1="39" y1="31" x2="39" y2="39" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" />
        <line x1="42" y1="32" x2="42" y2="38" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" />
        <polygon points="46,31 44,35 46,39" fill="#FFFFFF" />
      </g>

      {/* 5. 罐顶盖子 */}
      <ellipse cx="32" cy="20" rx="24" ry="8" fill={`url(#${metalShineId})`} stroke="#475569" strokeWidth="0.5" />
      {/* 内嵌槽 */}
      <ellipse cx="32" cy="20" rx="21" ry="7" fill="none" stroke="#475569" strokeWidth="1" opacity="0.5" />
      <ellipse cx="32" cy="20" rx="20.5" ry="6.8" fill={`url(#${metalDarkId})`} opacity="0.15" />

      {/* 6. 易拉罐拉环 */}
      <g id="pull-tab" opacity="0.9">
        <path d="M 32,20 L 26,19 L 28,21 Z" fill="#64748B" />
        <circle cx="32" cy="20" r="1.2" fill="#334155" />
        <circle cx="32" cy="20" r="0.6" fill="#94A3B8" />
        <ellipse cx="24" cy="19.5" rx="4.5" ry="2.5" fill="none" stroke={`url(#${metalShineId})`} strokeWidth="1.5" />
        <ellipse cx="24" cy="19.5" rx="2.5" ry="1.2" fill="none" stroke="#334155" strokeWidth="0.5" />
      </g>

      {/* 7. 整体斜向反光 */}
      <path d="M 18,20 Q 24,25 24,47 Q 21,47 18,44 Z" fill="#FFFFFF" opacity="0.12" />
    </svg>
  );
}