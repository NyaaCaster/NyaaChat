import React, { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  LogOut,
  Pencil,
  Check,
  X as XIcon,
  KeyRound,
  Loader2,
  AlertTriangle,
  Gift,
  PackagePlus,
  TrendingDown,
  TrendingUp,
  Wallet,
  Share2,
  Download,
  ThumbsUp,
  ThumbsDown,
  ExternalLink,
} from "lucide-react";
import { BaseModal } from "./BaseModal";
import { CatCanIcon } from "./icons/CatCanIcon";
import {
  type AccountProfile,
  type ApiResult,
  type StoredAccount,
  changePassword,
  clearStoredAccount,
  expandSlot as apiExpandSlot,
  fetchProfile,
  loadStoredAccount,
  login as apiLogin,
  logout as apiLogout,
  redeem as apiRedeem,
  register as apiRegister,
  rename as apiRename,
  saveStoredAccount,
} from "../lib/sharedAccountApi";

// Redeem UI feature flag. The redeem panel (catfood top-up via code) and its
// explanatory notices were built this phase, but catfood redemption is fulfilled
// by a third-party service whose API hasn't shipped — so the panel stays HIDDEN
// until that integration lands. Flip to true to re-expose it (the backend
// /redeem still 501s until then). The 兑换 button falls back to a "not open yet"
// notice while this is false, matching the original placeholder. (SSOT §6.)
const REDEEM_UI_ENABLED = false;
// Third-party site that issues redemption codes; opened in a new tab from the
// redeem panel's 获取兑换码 button.
const REDEEM_CODE_URL = "https://qyapi.qinyan.xyz/";

interface UserAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type AuthView = "login" | "register";

// Map backend error codes to Chinese copy. Network failures are handled
// separately (the design requires distinguishing them from bad credentials).
function messageFor(result: Extract<ApiResult<unknown>, { ok: false }>): string {
  if (result.kind === "network") return "服务器无法连接，请稍后再试";
  switch (result.error) {
    case "bad_credentials":
      return "账号或密码错误";
    case "account_taken":
      return "该账号已被注册";
    case "invalid_account":
      return "账号格式不正确（3-32 位，限字母/数字/ . _ -）";
    case "invalid_password":
      return "密码长度需为 6-64 位";
    case "invalid_username":
      return "用户名不合法（最多 24 字）";
    case "wrong_password":
      return "当前密码不正确";
    case "insufficient":
      return "猫粮余额不足";
    case "slot_max_reached":
      return "共享卡槽已达上限（200）";
    case "not_implemented":
      return "该功能尚未开放";
    default:
      return "操作失败，请重试";
  }
}

function formatRegisteredAt(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getFullYear() % 100)}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function UserAccountModal({ isOpen, onClose }: UserAccountModalProps) {
  // Session: null = logged out. Hydrated from localStorage on first open.
  const [session, setSession] = useState<StoredAccount | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!isOpen || hydrated) return;
    const stored = loadStoredAccount();
    setSession(stored);
    setHydrated(true);
    // Re-validate the stored token in the background; drop it if stale.
    if (stored) {
      fetchProfile(stored.token).then((r) => {
        if (r.kind === "ok") {
          const next = { token: stored.token, profile: r.data.profile };
          setSession(next);
          saveStoredAccount(next);
        } else if (r.kind === "error" && r.status === 401) {
          clearStoredAccount();
          setSession(null);
        }
        // network error: keep the cached session, user may be offline.
      });
    }
  }, [isOpen, hydrated]);

  const applyProfile = useCallback((profile: AccountProfile, token: string) => {
    const next = { token, profile };
    setSession(next);
    saveStoredAccount(next);
  }, []);

  const handleLogout = useCallback(async () => {
    if (session) await apiLogout(session.token);
    clearStoredAccount();
    setSession(null);
  }, [session]);

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="共享账号"
      titleIcon={<CatCanIcon size={20} />}
      maxWidth="max-w-md"
    >
      {!session ? (
        <AuthForm onAuthed={applyProfile} />
      ) : (
        <AccountPanel
          session={session}
          onProfile={(p) => applyProfile(p, session.token)}
          onLogout={handleLogout}
        />
      )}
    </BaseModal>
  );
}

// ---------------------------------------------------------------------------
// Logged-out: login / register
// ---------------------------------------------------------------------------
function AuthForm({
  onAuthed,
}: {
  onAuthed: (profile: AccountProfile, token: string) => void;
}) {
  const [view, setView] = useState<AuthView>("login");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => setError(null);

  const submit = async () => {
    if (busy) return;
    setError(null);
    if (!account.trim() || !password) {
      setError("请填写账号和密码");
      return;
    }
    setBusy(true);
    const result =
      view === "login"
        ? await apiLogin(account.trim(), password)
        : await apiRegister(account.trim(), password, username.trim() || undefined);
    setBusy(false);
    if (result.kind === "ok") {
      onAuthed(result.data.profile, result.data.token);
    } else {
      setError(messageFor(result));
    }
  };

  const inputCls =
    "w-full px-3 py-2 text-sm bg-transparent border border-gray-200 dark:border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow";

  return (
    <div className="p-4 sm:p-5 space-y-4">
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">
            账号
          </label>
          <input
            type="text"
            autoComplete="username"
            className={inputCls}
            value={account}
            onChange={(e) => {
              setAccount(e.target.value);
              reset();
            }}
            onKeyDown={(e) => e.key === "Enter" && view === "login" && submit()}
            placeholder="字母 / 数字 / . _ -，3-32 位"
          />
        </div>
        {view === "register" && (
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">
              用户名（可选）
            </label>
            <input
              type="text"
              className={inputCls}
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                reset();
              }}
              placeholder="留空则与账号相同，最多 24 字"
            />
          </div>
        )}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">
            密码
          </label>
          <input
            type="password"
            autoComplete={view === "login" ? "current-password" : "new-password"}
            className={inputCls}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              reset();
            }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={view === "register" ? "6-64 位" : "请输入密码"}
          />
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
          <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {view === "register" && (
        <div className="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400 bg-amber-500/5 border border-amber-500/20 rounded-xl px-3 py-2.5 space-y-1">
          <p className="font-semibold text-amber-600 dark:text-amber-400">注册前请知悉：</p>
          <p>· 本账号仅用于角色分享，不接管聊天记录、转发或扩展权限。</p>
          <p>· 账号数据不跨设备同步，仅与服务器关联。</p>
          <p>· 密码无法找回，请妥善保管。</p>
        </div>
      )}

      <div className="space-y-2 pt-1">
        <button
          onClick={submit}
          disabled={busy}
          className="w-full px-4 py-2 bg-blue-600 border border-transparent disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2 hover:shadow-glow"
        >
          {busy && <Loader2 size={16} className="animate-spin" />}
          {view === "login" ? "登录" : "注册并登录"}
        </button>
        <button
          onClick={() => {
            setView(view === "login" ? "register" : "login");
            setError(null);
          }}
          disabled={busy}
          className="w-full px-4 py-2 bg-transparent border border-gray-200 dark:border-white/10 hover:bg-gray-100 dark:hover:bg-white/5 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-xl transition-all disabled:opacity-50"
        >
          {view === "login" ? "没有账号？去注册" : "已有账号？去登录"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Logged-in: profile panel
// ---------------------------------------------------------------------------
function AccountPanel({
  session,
  onProfile,
  onLogout,
}: {
  session: StoredAccount;
  onProfile: (p: AccountProfile) => void;
  onLogout: () => void;
}) {
  const { profile, token } = session;
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(profile.username);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [expanding, setExpanding] = useState(false);

  const flash = (kind: "ok" | "err", text: string) => {
    setNotice({ kind, text });
    setTimeout(() => setNotice(null), 3000);
  };

  const saveName = async () => {
    const v = nameDraft.trim();
    if (!v || v === profile.username) {
      setRenaming(false);
      setNameDraft(profile.username);
      return;
    }
    setBusy(true);
    const r = await apiRename(token, v);
    setBusy(false);
    if (r.kind === "ok") {
      onProfile(r.data.profile);
      setRenaming(false);
      flash("ok", "用户名已更新");
    } else {
      flash("err", messageFor(r));
    }
  };

  // Expand the shared-slot ceiling: +5 slots for 5 catfood, capped at 200.
  // The server settles atomically and returns the fresh profile.
  const SLOT_COST = 5;
  const SLOT_CEILING = 200;
  const atSlotCeiling = profile.slotMax >= SLOT_CEILING;

  const expand = async () => {
    if (expanding) return;
    if (atSlotCeiling) {
      flash("err", "共享卡槽已达上限（200）");
      return;
    }
    if (profile.catfood < SLOT_COST) {
      flash("err", "猫粮余额不足");
      return;
    }
    setExpanding(true);
    const r = await apiExpandSlot(token);
    setExpanding(false);
    if (r.kind === "ok") {
      onProfile(r.data.profile);
      flash("ok", "已扩容 +5，扣除 5 猫粮");
    } else {
      flash("err", messageFor(r));
    }
  };

  // 兑换 entry: open the redeem panel when the feature is enabled, otherwise
  // fall back to the original "not open yet" notice.
  const onRedeemClick = () => {
    if (REDEEM_UI_ENABLED) {
      setRedeemOpen((v) => !v);
    } else {
      flash("err", "兑换功能尚未开放");
    }
  };

  return (
    <div className="p-4 sm:p-5 space-y-4">
      {notice && (
        <div
          className={`text-sm rounded-xl px-3 py-2 border ${
            notice.kind === "ok"
              ? "text-green-600 dark:text-green-400 bg-green-500/10 border-green-500/20"
              : "text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/20"
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* identity */}
      <div className="space-y-3">
        <Row label="账号">
          <span className="font-mono text-sm text-gray-800 dark:text-gray-200 break-all">
            {profile.account}
          </span>
        </Row>
        <Row label="用户名">
          {renaming ? (
            <div className="flex items-center gap-1.5 w-full">
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveName();
                  if (e.key === "Escape") {
                    setRenaming(false);
                    setNameDraft(profile.username);
                  }
                }}
                maxLength={24}
                className="flex-1 px-2 py-1 text-sm bg-transparent border border-gray-200 dark:border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={saveName}
                disabled={busy}
                className="p-1.5 text-green-600 hover:bg-green-500/10 rounded-lg transition-colors disabled:opacity-50"
                title="保存"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              </button>
              <button
                onClick={() => {
                  setRenaming(false);
                  setNameDraft(profile.username);
                }}
                className="p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 rounded-lg transition-colors"
                title="取消"
              >
                <XIcon size={15} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-800 dark:text-gray-200">{profile.username}</span>
              <button
                onClick={() => {
                  setNameDraft(profile.username);
                  setRenaming(true);
                }}
                className="p-1 text-gray-400 hover:text-blue-500 hover:bg-blue-500/10 rounded-md transition-colors"
                title="修改用户名"
              >
                <Pencil size={13} />
              </button>
            </div>
          )}
        </Row>
        <Row label="注册时间">
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {formatRegisteredAt(profile.createdAt)}
          </span>
        </Row>
      </div>

      <Divider />

      {/* economy */}
      <div className="space-y-3">
        <Row label="猫粮余额">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-sm font-semibold text-orange-500">
              <CatCanIcon size={16} /> {profile.catfood}
            </span>
            <button
              onClick={onRedeemClick}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-orange-600 dark:text-orange-400 border border-orange-500/30 hover:bg-orange-500/10 rounded-lg transition-colors"
            >
              <Gift size={13} /> 兑换
            </button>
          </div>
        </Row>

        {REDEEM_UI_ENABLED && redeemOpen && (
          <RedeemPanel
            token={token}
            onProfile={onProfile}
            onNotice={flash}
            onClose={() => setRedeemOpen(false)}
          />
        )}

        <Row label="历史消耗">
          <span className="inline-flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400">
            <TrendingDown size={14} className="text-red-400" /> {profile.spentTotal}
          </span>
        </Row>
        <Row label="累积收益">
          <span className="inline-flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400">
            <TrendingUp size={14} className="text-green-500" /> {profile.earnedTotal}
          </span>
        </Row>
        <Row label="共享卡槽">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300">
              <Wallet size={14} /> 上限 {profile.slotMax}
            </span>
            <button
              onClick={expand}
              disabled={expanding || atSlotCeiling}
              title={atSlotCeiling ? "已达上限 200" : "花费 5 猫粮 +5 卡槽"}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 border border-blue-500/30 hover:bg-blue-500/10 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {expanding ? <Loader2 size={13} className="animate-spin" /> : <PackagePlus size={13} />}{" "}
              扩容
            </button>
          </div>
        </Row>
      </div>

      <Divider />

      {/* stats */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
          共享统计
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Stat icon={<Share2 size={14} />} label="共享角色" value={profile.stats.sharedCount} />
          <Stat icon={<Download size={14} />} label="总下载" value={profile.stats.totalDownloads} />
          <Stat icon={<ThumbsUp size={14} className="text-green-500" />} label="好评" value={profile.stats.totalLikes} />
          <Stat icon={<ThumbsDown size={14} className="text-red-400" />} label="差评" value={profile.stats.totalDislikes} />
        </div>
      </div>

      {/* password change */}
      {pwOpen ? (
        <ChangePasswordForm
          token={token}
          onDone={(msg) => {
            setPwOpen(false);
            if (msg) flash("ok", msg);
          }}
          onError={(msg) => flash("err", msg)}
        />
      ) : (
        <button
          onClick={() => setPwOpen(true)}
          className="w-full px-4 py-2 bg-transparent border border-gray-200 dark:border-white/10 hover:bg-gray-100 dark:hover:bg-white/5 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2"
        >
          <KeyRound size={15} /> 修改密码
        </button>
      )}

      <button
        onClick={onLogout}
        className="w-full px-4 py-2 bg-transparent border border-red-500/30 hover:bg-red-500/10 text-red-600 dark:text-red-400 text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2"
      >
        <LogOut size={15} /> 退出登录
      </button>
    </div>
  );
}

function ChangePasswordForm({
  token,
  onDone,
  onError,
}: {
  token: string;
  onDone: (msg?: string) => void;
  onError: (msg: string) => void;
}) {
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [busy, setBusy] = useState(false);
  const inputCls =
    "w-full px-3 py-2 text-sm bg-transparent border border-gray-200 dark:border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow";

  const submit = async () => {
    if (busy) return;
    if (!oldPw || !newPw) {
      onError("请填写当前密码与新密码");
      return;
    }
    setBusy(true);
    const r = await changePassword(token, oldPw, newPw);
    setBusy(false);
    if (r.kind === "ok") {
      onDone("密码已修改");
    } else {
      onError(messageFor(r));
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      className="space-y-2 border border-gray-200 dark:border-white/10 rounded-xl p-3"
    >
      <input
        type="password"
        autoComplete="current-password"
        className={inputCls}
        value={oldPw}
        onChange={(e) => setOldPw(e.target.value)}
        placeholder="当前密码"
      />
      <input
        type="password"
        autoComplete="new-password"
        className={inputCls}
        value={newPw}
        onChange={(e) => setNewPw(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="新密码（6-64 位）"
      />
      <div className="flex gap-2 pt-1">
        <button
          onClick={submit}
          disabled={busy}
          className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2"
        >
          {busy && <Loader2 size={15} className="animate-spin" />}
          确认修改
        </button>
        <button
          onClick={() => onDone()}
          className="px-4 py-2 bg-transparent border border-gray-200 dark:border-white/10 hover:bg-gray-100 dark:hover:bg-white/5 text-gray-600 dark:text-gray-400 text-sm rounded-xl transition-all"
        >
          取消
        </button>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Redeem panel (catfood top-up via code) — behind REDEEM_UI_ENABLED.
// Catfood redemption is fulfilled by a third-party service (REDEEM_CODE_URL)
// that hasn't shipped its API, so submitting a code currently surfaces the
// backend's 501 ("尚未开放"). The panel + notices are built and verifiable now;
// the feature flag keeps it hidden until the integration lands. (SSOT §6.)
function RedeemPanel({
  token,
  onProfile,
  onNotice,
  onClose,
}: {
  token: string;
  onProfile: (p: AccountProfile) => void;
  onNotice: (kind: "ok" | "err", text: string) => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const inputCls =
    "flex-1 px-3 py-2 text-sm bg-transparent border border-gray-200 dark:border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 transition-shadow";

  const submit = async () => {
    if (busy) return;
    const v = code.trim();
    if (!v) {
      onNotice("err", "请输入兑换码");
      return;
    }
    setBusy(true);
    const r = await apiRedeem(token, v);
    setBusy(false);
    if (r.kind === "ok") {
      onProfile(r.data.profile);
      setCode("");
      onNotice("ok", "兑换成功，猫粮已到账");
      onClose();
    } else {
      onNotice("err", messageFor(r));
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      className="space-y-2.5 border border-orange-500/20 bg-orange-500/5 rounded-xl p-3"
    >
      <div className="flex items-center gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="请输入兑换码"
          className={inputCls}
        />
        <button
          onClick={submit}
          disabled={busy}
          className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-1.5"
        >
          {busy && <Loader2 size={15} className="animate-spin" />}
          兑换
        </button>
      </div>
      <div className="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400 space-y-1">
        <p>· 1 猫粮 = 1 icu 刀</p>
        <p>· 猫粮仅用于平台内角色共享，不可提现、不可转让。</p>
        <p>· NyaaChat 为非盈利平台，所有API额度收入均用于VibeCoding开发维护。</p>
      </div>
      <a
        href={REDEEM_CODE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs font-medium text-orange-600 dark:text-orange-400 hover:underline"
      >
        <ExternalLink size={13} /> 获取兑换码
      </a>
    </motion.div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 flex-shrink-0">
        {label}
      </span>
      <div className="min-w-0 flex items-center justify-end">{children}</div>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-gray-100 dark:border-white/5" />;
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 dark:bg-white/5">
      {icon}
      <div className="min-w-0">
        <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-tight">{label}</p>
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 leading-tight">{value}</p>
      </div>
    </div>
  );
}
