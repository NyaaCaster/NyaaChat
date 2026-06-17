// Payment dialog for acquiring a shared character (phase 4) — use / buyout.
//
// Opened only for a PRICED acquisition (free use never reaches here): the caller
// guarantees a live session. Shows the design's two notice texts (different for
// use vs. buyout), the current catfood balance (red when it can't cover the
// price), and a 购买 button disabled until the balance suffices.
//
// Real settlement is live this phase (the backend debits the buyer and credits
// the author); only catfood top-up / redemption stays a placeholder (phase 6).

import React from "react";
import { createPortal } from "react-dom";
import { Loader2, ShoppingCart } from "lucide-react";
import { BaseModal } from "./BaseModal";
import { CatCanIcon } from "./icons/CatCanIcon";

export type PaymentMode = "use" | "buyout";

const TEXTS: Record<PaymentMode, { title: string; line1: string; line2: string; confirm: string }> = {
  use: {
    title: "获得使用权",
    line1: "获得共享角色的使用权，可以在本地使用，但无法编辑和下载共享角色。",
    line2: "注意：删除、清除本地存储或更换设备后，需要重新购买使用权。",
    confirm: "购买使用权",
  },
  buyout: {
    title: "买断角色",
    line1: "将共享角色买断为完全私有角色，可编辑、可下载导出，无法获得更新。",
    line2: "注意：私有角色是纯本地数据，删除、清除本地存储或更换设备后无法继承，请导出下载后妥善保管。",
    confirm: "买断",
  },
};

interface SharedPaymentModalProps {
  isOpen: boolean;
  mode: PaymentMode;
  /** Character name, shown in the dialog header. */
  name: string;
  price: number;
  balance: number;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function SharedPaymentModal({
  isOpen,
  mode,
  name,
  price,
  balance,
  busy = false,
  onCancel,
  onConfirm,
}: SharedPaymentModalProps) {
  if (!isOpen) return null;

  const t = TEXTS[mode];
  const insufficient = balance < price;

  const modal = (
    <BaseModal
      isOpen={isOpen}
      onClose={busy ? () => {} : onCancel}
      title={t.title}
      titleIcon={<ShoppingCart size={16} className="text-blue-500" />}
      maxWidth="max-w-sm"
      footer={
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 px-4 py-2 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/10 disabled:opacity-50 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-xl transition-all"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={busy || insufficient}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2 hover:shadow-glow"
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            <span className="inline-flex items-center gap-1">
              {t.confirm}
              <CatCanIcon size={13} /> {price}
            </span>
          </button>
        </div>
      }
    >
      <div className="p-5 space-y-3 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
        <p className="font-medium text-gray-900 dark:text-gray-100 truncate">「{name}」</p>
        <p>{t.line1}</p>
        <p className="text-gray-500 dark:text-gray-400">{t.line2}</p>

        <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-white/5">
          <span className="text-gray-500 dark:text-gray-400">当前余额</span>
          <span
            className={`inline-flex items-center gap-1 font-semibold ${
              insufficient ? "text-red-500" : "text-orange-500"
            }`}
          >
            <CatCanIcon size={15} /> {balance}
          </span>
        </div>
        {insufficient && (
          <p className="text-xs text-red-500">余额不足，无法购买（需要 {price}）。</p>
        )}
      </div>
    </BaseModal>
  );

  return createPortal(modal, document.body);
}
