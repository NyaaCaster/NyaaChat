# NyaaComfyui图包 — 开发计划 SSOT

> **Single Source of Truth**。本文件是 NyaaComfyui图包 开发阶段的唯一事实来源。
> 状态符号：⬜ 未开始 / 🟡 进行中 / ✅ 已完成
> 关联文档：`初始设计.md`（原始需求，即 `NyaaComfyui图包-初始设计.md`）、`设计审核与决策.md`（决策记录）。
> 涉及两个仓库：`H:\GitHub\NyaaChat`（主）、`H:\GitHub\NyaaAcount`（平台定价登记）。

---

## 1. 项目目标与范围

为 NyaaChat 增加付费项目 **NyaaComfyui图包**：ComfyUI 节点（`comfyui-fixed` / `comfyui-custom`）生图的可消耗次数额度。

**范围边界（V1）**：
- ✅ 覆盖：额度存储、扩容（+30/5猫粮）、生图成功后端 −1、剩余次数展示、登录 gate、三处入口判定。
- ❌ 不覆盖：按次直扣猫粮模型、图包使用流水审计 UI、次数转赠。
- ❌ 不计费节点：QinyAPI 节点、用户自定义的 OpenAI 兼容节点、用户自定义的 ComfyUI 节点。**仅 `comfyui-fixed` 和 `comfyui-custom` 进入图包计费。**

## 2. 已确认的架构方案

见 `设计审核与决策.md`。核心三决策：
- **D1** 剩余次数存 **NyaaChat shared-server** `users` 表（业务额度落接入方，对标 kb_max）。
- **D2** 生图成功 −1 **后端原子扣减**（`WHERE remaining>0` 守卫）。
- **D3** 未登录触发 **复用 `UserAccountModal`**。

**计费模型**：次数包买断。扩容走 NyaaAcount `consume` 扣猫粮；每次生成 −1 仅本地。

## 3. 关键约束与安全要求

- 额度以**服务端为准**，前端 gate 仅体验优化。
- 扣费成功、本地写失败 → **必须** `rechargeBalance` 退款补偿（对标 `account.js:355-360`）。
- 消耗端点须 `requireAuth` + 校验 `nyaa_uid`。
- 改数据库前**必须备份** `.db` 文件（见 CLAUDE.md MUST 规则）。
- 测试后**必须清理**测试用户 / 临时脚本 / 恢复表状态。
- pricing.json 新 action 未登记 → consume 返回 `unknown_action`，故 **NyaaAcount 登记（P1）必须先于/同批于** shared-server 端点上线。

## 4. 数据模型

### 4.1 shared-server DB 新增列（`users` 表）
```sql
ALTER TABLE users ADD COLUMN comfyui_pack_remaining INTEGER NOT NULL DEFAULT 10;
```
- 语义：**剩余次数余额**（非上限）。默认 10 = 免费额度。
- 迁移方式：try/catch 包裹（对标 `db.js:111-115`）。
- 无硬顶（可累积扩容），下界 0。

### 4.2 常量（`account.js`）
```js
const COMFY_PACK_FREE      = 10;  // 免费额度（= DB 默认值，用于文档一致性）
const COMFY_PACK_EXPAND_STEP = 30;  // 每次扩容 +30 次
const COMFY_PACK_EXPAND_COST = 5;   // 每次扣 5 猫粮
```

### 4.3 NyaaAcount pricing.json（`nyaachat` 段新增 action）
```json
"expand_comfyui_pack": { "amount": 5, "label": "ComfyUI图包 +30", "effect": "ComfyUI图包剩余次数 +30" }
```
events.json `consume.NyaaChat` 同步登记：
```json
"expand_comfyui_pack": "扩容 ComfyUI图包（+30 次，5 猫粮）"
```

### 4.4 前端 `AccountProfile` 新增字段（`sharedAccountApi.ts`）
```ts
comfyuiPackRemaining: number; // ComfyUI 图包剩余生图次数（default 10, 扩容 +30, 生成 -1）
```
`profileOf`（后端）返回体加 `comfyuiPackRemaining: user.comfyui_pack_remaining`。

## 5. API 契约

### 5.1 扩容 `POST /api/shared/account/expand-comfyui-pack`
- Header：`Authorization: Bearer <session token>`；requireAuth。
- 逻辑（对标 expand-kb 四步）：校验 nyaa_uid → `ref = nyaachat:{account}:expand_comfyui_pack:{ts}` → `consume(uid,"expand_comfyui_pack",5,ref)` → 成功后 `UPDATE ... remaining += 30` → 本地写失败 `rechargeBalance` 退款。
- 返回：`{ ok:true, profile }`（含新 `comfyuiPackRemaining`）；`402 insufficient` / `503 account_service_unavailable` / `500 db_write_failed`。
- 无硬顶，故**无** `*_reached` 前置 409。

### 5.2 消耗 `POST /api/shared/account/consume-comfyui-pack`
- Header：`Authorization: Bearer <session token>`；requireAuth。
- 逻辑：原子 `UPDATE users SET comfyui_pack_remaining = comfyui_pack_remaining - 1 WHERE account=@account AND comfyui_pack_remaining > 0`。
  - `changes === 0` → `409 { ok:false, error:"pack_exhausted" }`（无剩余，前端据此弹扩容提示）。
  - `changes === 1` → `200 { ok:true, remaining:<新值> }`。
- **不碰 NyaaAcount**（纯本地余额消耗）。

### 5.3 读取剩余（复用 profile）
- ComfyUI 节点 UI 的「图包剩余」直接读 `AccountProfile.comfyuiPackRemaining`（登录会话已含）。
- 提供轻量刷新：复用 `fetchProfile(token)` 拉最新 profile；**不新增**专用读取端点（保持端点最小）。

## 6. 前端交互规格

### 6.1 共享账号面板（`UserAccountModal.tsx`）
- economy 区块新增一行「ComfyUI图包」（对标「知识库栈」行 `:497-520`）：
  - 展示：`剩余 {profile.comfyuiPackRemaining} 次`（**只显示剩余，不显示 已用/上限**）。
  - 「扩容」按钮 → `pendingExpand({ type:"ComfyUI图包", cost:5, stepLabel:"+30 次", handler: expandComfyuiPack })` → 复用 `ConfirmDialog`。
  - `expandComfyuiPack()` 调 `apiExpandComfyuiPack(token)` → `onProfile(r.data.profile)` + flash。

### 6.2 ComfyUI 节点详情（`ImageProvidersModal.tsx` `ComfyProviderDetail`）
- 「连通性检查」区块（`:796-828`）**后方**新增「图包剩余」区块：
  - 显示剩余次数数值（只显示剩余）。未登录显示「登录后可见」或引导登录。
  - 数值后加「扩容」按钮，逻辑同 6.1（复用扩容确认 → 调 `expandComfyuiPack` → 刷新）。
  - 读取：组件挂载时若已登录 `loadStoredAccount()` → 用 profile 值；扩容后本地刷新。
- **启用开关 gate**（`DetailHeader` toggle `:401-403`）：`comfyui-fixed`/`comfyui-custom` 从关→开时，检查登录态；未登录 → 打开 `UserAccountModal`，**不切换开关**；已登录 → 正常启用。

### 6.3 对话气泡「基于此消息生成图片」（`ChatInterface.tsx`）
`handleGenerateImage` / `runImageGeneration` 分流增强（仅当 `isComfyImage`）：
1. **未登录** → 打开 `UserAccountModal`，中止本次生图。
2. **已登录** → 生图前读剩余（profile / fetchProfile）：
   - `remaining > 0` → 正常走 ComfyUI 生图；**成功后**调 `consumeComfyuiPack(token)` 后端 −1，用返回 remaining 刷新展示。
   - `remaining <= 0` → 弹窗「NyaaComfyui图包 剩余次数不足，是否要扩容？」：
     - 「取消」关闭；「扩容」打开 `UserAccountModal`（共享账号界面）。
3. 非 ComfyUI 供应商 → 现有流程不变。
> 扣减放在 `runImageGeneration` 的 ComfyUI 成功分支（`ChatInterface.tsx:956-975` 之后、写入消息成功之处），失败/中止（catch 分支）**不调用**消耗端点。

### 6.4 节点内「测试生成」是否扣次数
- **不扣**。测试生成（`ImageProvidersModal` `handleTest`）是设置页调试，不经消耗端点。仅需登录态（因走固定服务器鉴权）；不做图包判定。

## 7. 版本与阶段划分（V1）

> 每个 P 可独立验证、独立提交。P 间有依赖顺序（P1 定价须先行）。

### P1 — NyaaAcount 定价登记 ✅
- 改 `NyaaAcount/api/src/topup/pricing.json`（nyaachat 段加 `expand_comfyui_pack`）。
- 改 `NyaaAcount/api/src/topup/events.json`（consume.NyaaChat 加同名事件）。
- 确认 token/key 复用现有 nyaachat 项目凭证（**无需**新增 env）。
- **验证**：重启 NyaaAcount 容器后，构造 consume 测试（临时脚本）确认 action 已知、金额 5、余额不足/成功路径正确；**测试后清理临时用户与脚本、恢复余额**。
- **收尾**：NyaaAcount 侧 commit-push + 交接。

### P2 — shared-server 后端 ✅
- 改 `shared-server/src/db.js`：ALTER TABLE 加 `comfyui_pack_remaining`（try/catch）。
- 改 `shared-server/src/routes/account.js`：常量 + `expandComfyuiPack`/`consumeComfyuiPack` prepared statements + 两个端点 + `profileOf` 加字段。
- **验证**：DB 备份 → rebuild → 用测试 token 打两个端点（扩容扣猫粮、消耗 −1、耗尽 409、退款补偿路径）；`profileOf` 返回新字段；**测试后清理**。
- **收尾**：commit-push + SSOT 标记 + 交接。

### P3 — 前端数据层 ✅
- 改 `src/lib/sharedAccountApi.ts`：`AccountProfile` 加 `comfyuiPackRemaining` + `expandComfyuiPack(token)` + `consumeComfyuiPack(token)`（返回 `{remaining}`）。
- **验证**：`tsc --noEmit` + `eslint` 通过；类型贯通。
- **收尾**：commit-push + SSOT 标记 + 交接。

### P4 — 共享账号面板 UI ✅
- 改 `src/components/UserAccountModal.tsx`：economy 区块加「ComfyUI图包」行 + 扩容按钮（复用 pendingExpand/ConfirmDialog）。
- **验证**：`npm run build` 通过；登录后可见剩余、扩容确认弹窗文案正确、扩容后刷新。
- **收尾**：commit-push + SSOT 标记 + 交接。

### P5 — ComfyUI 节点 UI（图包剩余 + 扩容 + 启用 gate）⬜
- 改 `src/components/ImageProvidersModal.tsx`：连通性检查后加「图包剩余」区块 + 扩容按钮；启用开关登录 gate（未登录打开 UserAccountModal）。
- **验证**：`npm run build`；节点详情显示剩余、扩容可用、未登录开关被拦并弹登录。
- **收尾**：commit-push + SSOT 标记 + 交接。

### P6 — 对话生图链路 gate + 扣减 ⬜
- 改 `src/components/ChatInterface.tsx`：`handleGenerateImage`/`runImageGeneration` 加登录 gate、剩余预检、成功后 `consumeComfyuiPack` −1、耗尽弹窗（取消/扩容→打开账号面板）。
- 可能需 `MessageItem` / 弹窗组件配合（复用现有 ConfirmDialog）。
- **验证**：`npm run build`；三条路径（未登录/有余额生图并−1/无余额弹窗）真机验证。
- **收尾**：commit-push + SSOT 标记 + 交接。

### P7 — 端到端联调 + rebuild 真机验证 ⬜
- rebuild NyaaChat（`python rebuild.py`）；跨 NyaaChat↔NyaaAcount 全链路：登录→节点启用→生图−1→耗尽→扩容扣猫粮+30→继续生图。
- 更新本 SSOT 全部标记为 ✅；总交接文档。
- **验证**：全链路通过；DB 备份留存至确认无副作用；`git status` 双仓库干净。
- **收尾**：双仓库 commit-push + memory 记录 V1 完成。

## 8. 文件改动清单

**NyaaAcount**：
- `api/src/topup/pricing.json`、`api/src/topup/events.json`

**NyaaChat**：
- `shared-server/src/db.js`（迁移列）
- `shared-server/src/routes/account.js`（常量 + 语句 + 2 端点 + profileOf）
- `src/lib/sharedAccountApi.ts`（类型 + 2 API 函数）
- `src/components/UserAccountModal.tsx`（图包行）
- `src/components/ImageProvidersModal.tsx`（图包剩余 + 扩容 + 启用 gate）
- `src/components/ChatInterface.tsx`（生图 gate + 扣减 + 耗尽弹窗）
- 本 `.docs/NyaaComfyui-package-plan/` 下的规划与交接文档

**无需改动**：`nginx.conf`（走现成 `/api/shared/` 规则）、`nyaacount-client.js`（复用 consume/recharge）、NyaaAcount 的 `project.js`/`db.js`/`auth.js`/`crypto.js`。

## 9. 验证步骤总表

| 层 | 命令/操作 |
|----|----------|
| 类型 | `tsc --noEmit`（NyaaChat 根） |
| Lint | `eslint`（按项目脚本） |
| 前端构建 | `npm run build` |
| 镜像重建 | `python rebuild.py`（NyaaChat）/ NyaaAcount rebuild skill |
| DB 备份 | 改库前复制 `.db`（带时间戳） |
| 清理 | 测试后删测试用户/脚本，`git status` 确认干净 |

## 10. 进度总览

| P | 阶段 | 状态 |
|---|------|------|
| P1 | NyaaAcount 定价登记 | ✅ |
| P2 | shared-server 后端 | ✅ |
| P3 | 前端数据层 | ✅ |
| P4 | 共享账号面板 UI | ✅ |
| P5 | ComfyUI 节点 UI + 启用 gate | ⬜ |
| P6 | 对话生图 gate + 扣减 | ⬜ |
| P7 | 端到端联调 + rebuild | ⬜ |
