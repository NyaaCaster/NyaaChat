import { useState } from "react";
import { Eye } from "lucide-react";

interface ApiKeyInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  onBlur?: () => void;
}

/**
 * Press-and-hold to reveal an API key in plain text. `pointerdown`/`pointerup`
 * covers mouse + touch + pen with a single listener pair, and `pointerleave`
 * re-hides the key if the user drags off the icon while still pressing.
 */
export function ApiKeyInput({ value, onChange, placeholder, onBlur }: ApiKeyInputProps) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="relative">
      <input
        type={revealed ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        className="w-full px-4 py-3 pr-12 border border-gray-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50 dark:bg-[#1A1A1A] text-gray-900 dark:text-gray-100 outline-none transition-all placeholder:text-gray-400 dark:placeholder:text-gray-600 font-mono"
      />
      <button
        type="button"
        aria-label="按住显示 API Key"
        title="按住显示"
        onPointerDown={(e) => {
          e.preventDefault();
          setRevealed(true);
        }}
        onPointerUp={() => setRevealed(false)}
        onPointerLeave={() => setRevealed(false)}
        onPointerCancel={() => setRevealed(false)}
        className={`absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-colors select-none touch-none ${
          revealed
            ? "text-blue-600 dark:text-blue-400 bg-blue-500/10"
            : "text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5"
        }`}
      >
        <Eye size={16} />
      </button>
    </div>
  );
}
