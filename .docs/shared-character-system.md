# NyaaChat 共享角色系统开发计划（shared-character-system）

> 本文件是 NyaaChat「共享角色库」功能的可跟踪 SSOT 计划。
> 目标是在现有**纯本地私有角色**体系之上，叠加一套基于独立后端的**共享角色发布 / 浏览 / 使用 / 买断**系统，并配套账号、猫粮货币、共享卡槽等账号级机制。
>
> 来源设计：`.ref/我想在本项目中建立一个共享角色系统.md`
> 创建：2026-06-17
> 状态：阶段 0、阶段 1 完成；阶段 2（分享管线）待实施

---

## 0. 背景与边界

NyaaChat 现有角色体系全部为**私有角色**：角色数据存 localStorage（`nyaachat_settings` → `characters[]`），封面图存 IndexedDB（`coverStorage.ts`，512×768 WebP，settings 内只留 `coverImage` 标记），可编辑、可导出（PNG / SillyTavern json）。

`CharacterSettings` 已预留共享系统所需字段（无 UI）：`version`、`globalId`、`author`、`source`、`intro`、`shared`。本计划在此地基上构建完整系统。

边界：

- 本账号系统**仅**用于角色发布分享的权限管理，**不**接管任何 LLM 聊天记录、消息转发、扩展管理权限。
- 共享后端与 NyaaChat 前端**分别**部署、分别 rebuild、分别维护。
- 支付 / 兑换业务逻辑本期**仅占位**，留备忘，不实现真实结算。

---

## 1. 概念定义（来自设计文档）

| 概念 | 含义 |
| --- | --- |
| 私有角色 | 当前已实现的本地角色，存本地，可编辑/导出 |
| 共享角色 | 发布到服务器的公共角色，可只读使用或买断为私有 |
| 共享角色使用权 | 只读使用，不可编辑、不可文件下载 |
| 猫粮 | 账号级货币，仅兑换码兑换获得，不接受现金 |
| 共享卡槽 | 账号级数值，限制同时使用的只读共享角色上限（初始 20） |

---

## 2. 架构决策（已与用户拍板）

| 项 | 决策 | 解决的设计疑问 |
| --- | --- | --- |
| 后端栈 | Node + Express + better-sqlite3，独立容器，端口 **5107** | 与前端 Node/TS 工具链一致；#176 |
| 网络拓扑 | 两 compose 项目挂同一 external 网络 `nyaachat-net`；主 nginx 反代 `/api/shared/` → `nyaachat-shared:5107`，封面走 `/api/shared/covers/<id>`，**全程同源** | #167 跨端口/跨域 URL 拼接 |
| 元数据存储 | sqlite（利于搜索/排序/标签/计数） | #168 |
| 封面存储 | 文件系统；服务器只存重编码纯 WebP（不含 PNG tEXt chunk），json 单独存 DB | #173 防窃取 |
| 远程管理 | DB 文件 bind mount 到宿主大盘 `E:\DockerRes\nyaachat-shared\db\`，Navicat for SQLite 直接打开文件 | #178 |
| 大文件落盘 | db、covers 均 bind mount 到 `E:\DockerRes\nyaachat-shared\`（遵守用户级 Docker 大文件约定） | — |
| 更新时间 | Unix 毫秒时间戳列排序 | #102 |
| 标签清单 | 角色行存 `tags` JSON 列，`SELECT DISTINCT ... json_each` 派生去重清单 | #98 |
| 搜索冷却 | **不做** 10s 人工冷却，改前端 400ms 防抖 + sqlite 索引 LIKE，必要时再加 | #93 / #100 |
| 密码 | 按用户明确要求**明文**存储，仅经同源代理传输 | #179 |

---

## 3. 数据模型（sqlite）

### users
| 列 | 类型 | 说明 |
| --- | --- | --- |
| account | TEXT PK | 账号 GUID，纯英文字母/数字/符号 |
| username | TEXT | 仅显示用 |
| password | TEXT | **明文**（人工维护需要） |
| created_at | INTEGER | 注册时间 Unix ms |
| catfood | INTEGER | 猫粮余额，≥0，无小数 |
| spent_total | INTEGER | 历史消耗累计（只记消耗） |
| earned_total | INTEGER | 累积收益累计（只记收益） |
| slot_max | INTEGER | 共享卡槽上限，初始 20 |

> `slot_used`（卡槽占用）是**客户端**本地共享角色计数，不入服务器（占用随本地储存增删而变）。
> `共享角色数 / 总下载 / 总好评 / 总差评`由对 `shared_characters` 的聚合查询得出，不冗余存 users。

### shared_characters
| 列 | 类型 | 说明 |
| --- | --- | --- |
| global_id | TEXT PK | 共享卡全局唯一 id，**删除后不复用、不变化**（#182） |
| owner | TEXT | 上传作者 account（外键 users.account） |
| author | TEXT | 作者显示名（上传时填，亦作隐藏索引标签） |
| name | TEXT | 角色名（取自角色数据 Character Name） |
| source | TEXT | `original` / `reposted` |
| intro | TEXT | 简介 ≤100 中文字符（非角色 description） |
| tags | TEXT(JSON) | 标签数组 |
| use_price | INTEGER | 使用权价格（0=免费） |
| buyout_price | INTEGER | 买断价格（0=不卖，不显示买断） |
| card_json | TEXT | ST 格式角色卡 json（不含封面像素） |
| cover_ext | TEXT | 封面文件扩展（webp），文件名即 global_id |
| downloads | INTEGER | 下载/更新次数 |
| likes | INTEGER | 好评计数 |
| dislikes | INTEGER | 差评计数 |
| created_at | INTEGER | 创建 Unix ms |
| updated_at | INTEGER | 最后更新 Unix ms（无更新=创建时间），排序用 |

### ratings
| 列 | 类型 | 说明 |
| --- | --- | --- |
| account | TEXT | 评价者 |
| global_id | TEXT | 被评角色 |
| value | INTEGER | 1=好评 / -1=差评（每账号每角色唯一，好评差评互斥） |

主键 `(account, global_id)`。

### sessions（鉴权）
登录返回不透明 token，存 `(token, account, created_at)`；前端存 localStorage `nyaachat_account`。

---

## 4. 分阶段任务

每阶段结束：独立 rebuild + 真机验证 + commit/push + 更新本文件与 memory 进度。

### 阶段 0 — 脚手架与 SSOT　【已完成】
- [x] `shared-server/`：Express + better-sqlite3 + Dockerfile + package.json
- [x] db schema 初始化 + `/health` 健康页（**无任何表现页面**，#177）
- [x] `docker-compose.shared.yml`（项目名 `nyaachat-shared`，5107，external 网络，db/covers bind mount 到 `E:\DockerRes`）
- [x] 主 `docker-compose.yml` + `nginx.conf` 加入 `nyaachat-net` 与 `/api/shared/`、`/api/shared/covers/` 反代
- [x] `rebuild-shared.ps1/.sh` + `.claude/skills/rebuild-shared/` skill
- [x] 便捷 SQL 脚本 `shared-server/sql/`（用户查询、共享角色插/删，删除保留全局 id，#180-182）
- [x] 本 SSOT 与 memory `plan_shared_character_system.md`

> 阶段 0 真机验证（2026-06-17）：直连 `:5107/health` 与同源 `:3095/api/shared/health`
> 均返回 `{ok:true, db:ok}`；DB 文件落盘宿主 bind mount，四表 users/sessions/
> shared_characters/ratings 创建成功。封面 `/api/shared/covers/` 静态路由待阶段 2 接入。

### 阶段 1 — 账号系统　【首交付】
- [x] schema users + sessions；token 鉴权
- [x] 后端：注册 / 登录 / 改密 / 改名 / 取资料；兑换、扩容卡槽为占位（写 memo）
- [x] 前端：彩色猫罐头 SVG 图标（256 / 25 两尺寸）
- [x] ChatHeader 在「用户角色」左侧加 id-card 按钮
- [x] `UserAccountModal`：
  - 未登录=账号/密码 + 登录(主)/注册(次)；登录失败区分「账号密码错误」与「服务器无法连接」；注册三条免责提醒
  - 已登录=账号 / 用户名+改名 / 注册时间 / 余额+兑换占位 / 历史消耗 / 累积收益 / 共享卡槽+扩容占位 / 统计（共享角色数/下载/好评/差评）
- [x] 登录态存 localStorage 维持

> 阶段 1 落地（2026-06-17）：
> **后端** `shared-server/src/`：`auth.js`（`randomBytes(32)` 不透明 token，写
> sessions 表；`requireAuth` 读 `Authorization: Bearer`→sessions→users 挂 req.user；
> 孤儿 token 自动清理）、`routes/account.js`（`POST /register`|`/login`|`/logout`|
> `/rename`|`/password`、`GET /profile`；`/redeem`、`/expand-slot` 返回 501 占位）。
> server.js `app.use("/account", accountRouter)`。校验：account `^[A-Za-z0-9._-]{3,32}$`、
> 密码 6-64、username ≤24（注册留空则默认=account）。`profile` 返回派生统计（聚合
> shared_characters）。登录失败统一 401 `bad_credentials`（不区分账号不存在/密码错），
> 让前端只需区分「凭据错」与「连不上」。
> **前端**：`lib/sharedAccountApi.ts`（同源 `/api/shared/account/*`，
> 判别式 union 以 **`kind` 字符串**为判别字段——本项目 `strictNullChecks` 关闭，
> boolean 字面量 `ok` 无法收窄；网络/超时/502-503-504 无 JSON ok → `kind:"network"`，
> 业务错误 → `kind:"error"`+status；登录态读写 localStorage `nyaachat_account`）、
> `components/icons/CatCanIcon.tsx`（彩色猫罐头，`size` prop 同时服务 25 与 256，
> useId 隔离渐变）、`components/UserAccountModal.tsx`（BaseModal；未登录登录/注册双态、
> 已登录资料面板含内联改名+改密折叠+兑换/扩容占位 toast）、ChatHeader
> 「用户角色」左侧新增 `IdCard` 按钮，自管 state + portal 打开（与 Version/Extensions/
> Regex 同模式）。
> 真机验证（rebuild-shared + rebuild 双重启后，:3095 同源 Playwright）：注册→已登录
> 面板（用户名中文 UTF-8 正常、注册时间 YY-MM-DD hh:mm）、改名、改密+新密码登录、
> profile、登录态跨刷新保持（后台 token 复验通过）、退出登录、账号密码错误提示、
> 停后端 502→「服务器无法连接」、兑换/扩容→「尚未开放」占位 toast，全部通过。
> 验证用 demo 账号已从 DB 清除（users/sessions 归零）。

### 阶段 2 — 分享管线
私有卡条目加「分享」按钮 → 警示对话框 → 登录校验 → 角色分享界面（来源 / 简介 100 字 / 标签 / 使用权定价 / 买断定价）→ 上传 ST json + 封面。

### 阶段 3 — 共享角色库浏览
`SharedLibraryModal`（PC 三列+左栏 / 手机单列+标签弹窗）、搜索、排序（更新/下载/好评/差评）、标签筛选、作者名可点筛选。

### 阶段 4 — 使用 / 买断
免费直接获得（绿色按钮）、付费支付占位、买断→按导入逻辑转私有卡；使用占卡槽+1，买断不占。

### 阶段 5 — 私有列表中的共享卡
`共享` tag、无编辑/导出、`更新`按钮+版本角标提示、已删除提示、删除-卡槽-1；作者本人可见编辑/删除。

### 阶段 6 —（后续）支付真实业务逻辑
兑换码 / 猫粮结算；本期全部占位并备忘。

---

## 5. 核心约束（架构层落实）

1. 发布共享角色必经账号系统。
2. 使用态共享角色不可编辑、不可导出（作者权益）。
3. 服务器封面图不内嵌角色 json（重编码纯 WebP，json 单独存 DB）。

---

## 6. 占位 / 备忘清单（待阶段 6 实现）

- 兑换码兑换猫粮（成功/失败弹窗）— 仅 UI 占位
- 「1 猫粮 = 1 icu 刀」提示 — 暂隐藏，兑换功能完成后开放
- 「NyaaChat 为非盈利平台…」提示 — 暂隐藏，兑换功能完成后开放
- 「获取兑换码」跳转 `https://qyapi.qinyan.xyz/` — 暂禁用
- 扩容共享卡槽（猫粮 5 → +5）— UI 占位，余额校验先行
- 使用权 / 买断付费 — 支付界面占位，余额校验先行
