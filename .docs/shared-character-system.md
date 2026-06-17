# NyaaChat 共享角色系统开发计划（shared-character-system）

> 本文件是 NyaaChat「共享角色库」功能的可跟踪 SSOT 计划。
> 目标是在现有**纯本地私有角色**体系之上，叠加一套基于独立后端的**共享角色发布 / 浏览 / 使用 / 买断**系统，并配套账号、猫粮货币、共享卡槽等账号级机制。
>
> 来源设计：`.ref/我想在本项目中建立一个共享角色系统.md`
> 创建：2026-06-17
> 状态：阶段 0、阶段 1、阶段 2、阶段 3、阶段 4、阶段 5（5a）完成；阶段 5b（作者本人编辑/发布更新）、阶段 6（支付真实业务）待实施

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

### 阶段 2 — 分享管线　【已完成】
私有卡条目加「分享」按钮 → 警示对话框 → 登录校验 → 角色分享界面（来源 / 简介 100 字 / 标签 / 使用权定价 / 买断定价）→ 上传 ST json + 封面。

- [x] 后端 `src/routes/characters.js`：`POST /characters`（鉴权）+ `GET /covers/:id`，server.js 挂载
- [x] 前端 `lib/sharedCharacterApi.ts`（同构 request）+ `CharacterShareModal.tsx` + `pngCard.makePlaceholderCoverWebp`
- [x] `CharacterSelectionModal` 每条目加 `分享`(CloudUpload) 按钮 → 警示 → 登录校验 → 分享界面

> 阶段 2 落地（2026-06-17）：
> **后端** `src/routes/characters.js`：`POST /characters`（`requireAuth`）接收
> `{ source, intro?, tags?, usePrice, buyoutPrice, cardJson, coverBase64 }`。校验：
> `source∈{original,reposted}`；`intro` 按**码点** `[...s].length≤100`（与前端计数一致）；
> `tags` trim/去空/去重，单个≤20 码点、总数≤20；价格非负整数；`cardJson` 可 parse
> 且能取出 `name`（取 `parsed.name ?? parsed.data.name`，**角色名从卡数据取**不单独传）；
> `coverBase64` 解码后校验 RIFF/WEBP magic bytes（≤4MB）。`global_id` 后端
> `randomBytes(16).hex` 生成（删除不复用）；`owner=req.user.account`、
> **`author=req.user.username`**（分享界面无 author 框，自动取登录用户名）。落盘顺序：
> 先写封面文件 `COVERS_DIR/<global_id>.webp` 成功再 insert DB 行（避免引用缺失封面）。
> `GET /covers/:id`：hex 白名单防路径穿越→查 `cover_ext`→读盘返回 `image/webp`
> （`Cache-Control: public,max-age=86400`），缺失 404。covers 路由独立挂载（不用裸
> `express.static` 暴露目录）。nginx 既有 `/api/shared/` 前缀通配已覆盖
> `/characters`、`/covers`，`client_max_body_size 8m` 够用，**无需改 nginx**。
> **前端**：`lib/sharedCharacterApi.ts`（与 `sharedAccountApi` 同构的 `request`，
> `BASE=/api/shared`，复用其 `ApiResult` 判别式 union；超时放宽到 30s 容纳封面上传；
> `blobToBase64` 去 data: 前缀；**不动**已验证的 `sharedAccountApi.ts`）、
> `pngCard.makePlaceholderCoverWebp(name)`（复用 `drawPlaceholder` 生成 512×768 占位
> WebP，供无封面卡分享）、`CharacterShareModal.tsx`（BaseModal+createPortal；来源单选+
> 提示、简介 textarea 实时 `码点/100` 计数、标签输入+chip 删除、使用权档
> 免费/3/6/36/60/200/自定价、买断档 不卖/5/8/60/100/350/自定价、封面预览=与上传同样
> 经 `imageBlobToCoverWebp` 再过一遍 canvas 确保无内嵌 json；提交用
> `convertToSillyTavernCharacter` 生成纯 ST json）、`CharacterSelectionModal` 每条目加
> `分享`(CloudUpload) 按钮 → `ConfirmDialog` 警示（设计原文「您将为自己公开分享的
> 角色承担所有责任…⚠请勿转载分享类脑和旅途作者发布的角色卡。」拒绝/同意）→ 同意时
> `loadStoredAccount()`：已登录开 `CharacterShareModal`、未登录开 `UserAccountModal`
> 引导登录。
> 真机验证（rebuild-shared + rebuild 双重启后，:3095 同源 Playwright）：未登录分享→
> 警示→同意→引导登录弹窗；注册 demo→关闭→再分享→警示→同意→分享界面（封面预览/
> 角色名/作者=用户名/来源/简介计数/标签/价格档全渲染）；填表确认发布→`POST
> /api/shared/characters` 200，弹窗关闭。后端核对：DB 行字段全对
> （owner/author/name/source/intro/tags/价格/cover_ext），封面落盘 `<global_id>.webp`，
> 同源 `/api/shared/covers/<id>` 返回 200 image/webp（真 RIFF/WebP）；防窃取核验=
> 封面二进制搜不到角色 description/chara_card/first_mes（无内嵌 json）；card_json 为
> `chara_card_v3 3.0` 含 character_book。整轮 console 零 error。demo 数据已清
> （character/user/session/cover 全删，localStorage 登录态已清）。
>
> 阶段 2 修订（2026-06-17，自定价下限）：使用权 / 买断的**自定价档**最低为 **1**——
> `CharacterShareModal.resolvePrice` 自定价校验由 `n < 0` 改为 `n < 1`（返回 null 即拦截、
> 不提交、不关弹窗），提交错误文案 `使用权自定价不能低于 1` / `买断自定价不能低于 1`，
> 自定金额 `<input min={1}>`。**预设档不受影响**（使用权「免费」=0、买断「不卖」=0 仍合法）；
> 后端 `isPrice`（≥0）保持不变——自定价 ≥1 由前端保证，后端只需接受预设档的 0。真机
> Playwright 验证：自定价 0→拦截+对应提示+不提交，1→放行（边界正确），DB 无误发布数据。

### 阶段 3 — 共享角色库浏览　【已完成】
`SharedLibraryModal`（PC 三列+左栏 / 手机单列+标签弹窗）、搜索、排序（更新/下载/好评/差评）、标签筛选、作者名可点筛选。

- [x] 后端 `src/routes/characters.js`：`GET /characters`（q/tag/author/sort/order，**不返回 card_json**）+ `GET /characters/tags`（去重标签清单）
- [x] 前端 `lib/sharedLibraryApi.ts`（只读列表/标签客户端 + coverUrl helper）
- [x] `SharedLibraryModal.tsx`（响应式布局、搜索防抖、排序升降、标签/作者筛选、空结果文案）
- [x] `CharacterSelectionModal` 标题栏 `titleAction` 加「共享角色库」入口

> 阶段 3 边界（已与用户拍板）：**纯浏览**。条目完整展示公开信息但**不渲染任何动作按钮**——
> 使用 / 买断留阶段 4，编辑 / 删除留阶段 5，评价随阶段 4。
>
> 阶段 3 落地（2026-06-17）：
> **后端** `src/routes/characters.js` 在既有 `POST /` + `GET /covers/:id` 上新增两个
> **公开（无鉴权）只读**端点：`GET /characters`（query `q`/`tag`/`author`/`sort`/`order`）
> 与 `GET /characters/tags`。`GET /characters`：`sort` 经**白名单映射**
> `{updated→updated_at, downloads, likes, dislikes}`（绝不把用户输入拼进 SQL），
> `order` 仅取 asc/desc，二级排序 `global_id ASC` 保证等值稳定；`author` 精确等值；
> `tag` 用 `EXISTS(SELECT 1 FROM json_each(tags) WHERE value=@tag)` 精确匹配（避免
> LIKE 把 "cat" 误命中 "category"）；`q` 对 `name/author/intro/tags` 四列 `LIKE @like
> ESCAPE '\'`，配 `escapeLike()` 转义 `% _ \` 防用户输入当通配；返回字段
> **刻意不含 `card_json`**（浏览只需摘要，省流量且不在使用/买断前交出设计），封面仍走既有
> `/api/shared/covers/<id>`；`LIMIT 200` 硬兜底（非分页）。`GET /characters/tags`：
> `SELECT DISTINCT je.value FROM shared_characters, json_each(tags) je`，`COLLATE NOCASE`
> 排序去重。两端点均 GET、与 `POST /` 方法不冲突，server.js 既有 `/characters` 挂载
> 与 nginx `/api/shared/` 通配已覆盖，**无需改 server.js / nginx**。
> **前端**：`lib/sharedLibraryApi.ts`（与 account/publish 同构 `request`，复用 `ApiResult`
> 判别式 union；`SharedCharacterSummary` 接口、`fetchLibrary(query)` 用 URLSearchParams
> 拼 query、`fetchTags()`、`coverUrl(globalId)` helper；**不动**已验证的两个 api 文件）、
> `components/SharedLibraryModal.tsx`（BaseModal+createPortal，`max-w-4xl`；搜索 400ms 防抖
> `q→debouncedQ`、排序点击同键切升降·异键切键并重置 desc·激活键带方向箭头、标签默认「全部」
> 单选、作者名按钮可点筛选 + 「取消」清搜索/作者保留标签、条目卡=封面(lazy,onError 占位)/
> 来源 tag(原创蓝·转载琥珀)/角色名/`@作者`(可点)/更新时间 YY-MM-DD hh:mm/简介 line-clamp-2/
> 标签 chip(最多4)/使用价(0=免费绿色·否则 CatCanIcon+值)/买断价(>0 才显示)/下载·好评·差评
> 计数；空结果「没有符合条件的共享角色」；手机版「标签」按钮开二级 BaseModal 单选弹窗选后关闭）、
> `CharacterSelectionModal` 标题栏用 BaseModal `titleAction` slot 加「共享角色库」(Library 图标)
> 入口，自管 `isLibraryOpen` state。
> **坑（已解决）**：响应式显隐 `hidden md:flex` / `md:hidden` / `flex-col md:flex-row`
> **全部失效**——根因同 SSOT 既有的封面条问题：宿主第三方扩展 **JS-Slash-Runner 自带完整
> Tailwind 构建**，其 `.hidden{display:none}` / `.flex` 泄漏进主文档且**压过** app 的
> Tailwind 工具类（实测新建 `.md:flex` 元素正常、但带 `hidden` 的 aside 仍 none）。
> 遵循项目既有惯例（index.css `.cover-side`/`.cover-avatar`）：改用 **app 私有类 +
> `!important` + 48rem 媒体查询**驱动显隐——`index.css` 加 `.lib-sidebar`/`.lib-topbar`/
> `.lib-layout`（unlayered，扩展不会 target），组件 aside/topbar/外层容器换用这些类。
> 注：`grid-cols` 响应式未受影响（grid-template-columns 非 display/flex，扩展未覆盖），保留
> Tailwind `sm:grid-cols-2 lg:grid-cols-3`。
> 真机验证（rebuild-shared + rebuild 双重启后，:3095 同源 Playwright，1280px PC / 420px 手机）：
> 用后端 API 注册临时 demo_p3 发布 4 张差异化测试卡（原创/转载·不同标签·使用价 0/6/36·买断价
> 0/60/100/350）→ 开库：4 卡全渲染（封面 img 加载/来源 tag/作者/时间/简介/标签/价格档·侦探阿杰
> 买断价 0 正确隐藏买断/计数）；搜索「猫娘」防抖只剩魔法猫娘；标签「原创」筛出 2 张；作者
> 「@测试发布者」叠加筛选 + 「取消」清作者保留标签；排序点击切键/方向无错；搜不存在词→空结果文案；
> 手机版「标签」二级弹窗 全部+9 标签 NOCASE 排序、选后关窗筛选；resize 验证 PC 侧栏 flex/手机
> 顶栏 block/layout row↔column/grid 3 列正确切换。console 仅 JS-Slash-Runner 扩展自身
> `parentNode` error（第三方既有，与本功能无关），本功能代码零 error。tsc+eslint 干净。
> demo 数据已清（demo_p3 账号 CASCADE 删 4 卡+session、4 封面文件删尽，covers 目录空），
> **保留 nyaa 真实账号**（无共享卡的干净态）。截图临时文件已删。

### 阶段 4 — 使用 / 买断　【已完成】
免费直接获得（绿色按钮）、付费支付占位、买断→按导入逻辑转私有卡；使用占卡槽+1，买断不占。

- [x] 后端 `src/routes/characters.js`：`POST /characters/:id/acquire`（可选鉴权·结算·downloads+1·返回 card_json）+ `POST /characters/:id/rating`（1/-1/0 互斥·重算计数）+ `GET /characters/mine/ratings`（鉴权返回评价映射）；`auth.js` 加软鉴权 `resolveUser`
- [x] 前端 `lib/sharedLibraryApi.ts` 扩展（acquire/rate/fetchMyRatings/fetchCoverBlob）+ `SharedPaymentModal.tsx`（支付界面）+ `SharedLibraryModal.tsx` 加使用/买断/好评/差评
- [x] `CharacterSelectionModal` 接线（onUse 加 shared 卡+开新对话；onBuyout 加私有卡）

> 阶段 4 边界（已与用户拍板）：
> 1. **付费真实结算**——「余额够就真实结算」：付费使用 / 买断在余额充足时**真实扣费**
>    （买家 `catfood↓ / spent_total↑`，作者 `catfood↑ / earned_total↑`，买家==作者跳过），
>    仅**兑换码充值**仍占位（阶段 6）。免费使用（价 0）一律真实获得，无需登录。
> 2. **评价可取消可切换**：好评/差评互斥，再点同项取消（value 0 删行），点对项切换。
> 3. **显示治理留阶段 5**：使用态共享卡落入本地私有列表后，本阶段**只加卡**，
>    其「共享」tag / 无编辑导出 / 更新按钮 / 删除-槽-1 等显示治理全部留阶段 5。
> 4. **卡槽上限强制**：使用前校验本地 `shared` 卡数 < `slotMax`（登录态读 profile，
>    未登录默认 20），满则拦截「共享卡槽已满，请先清理或扩容」；买断不占槽、不校验。
>
> 阶段 4 落地（2026-06-17）：
> **后端**：`auth.js` 新增 `resolveUser(req)`（软鉴权：解析 Bearer→session→user，
> 无/失效返回 null 而不响应，扫孤儿 token；与 `requireAuth` 并存）。
> `routes/characters.js` 三个新端点：
> - `POST /:id/acquire`（**可选鉴权**，body `{mode:"use"|"buyout"}`）：:id 校验 hex；
>   buyout 价 0→`not_for_sale`；价>0 时无 token→401、`catfood<价`→402 `insufficient`、
>   否则 `db.transaction` 内 `debitBuyer`(catfood-/spent+) + `creditAuthor`(catfood+/earned+)
>   + `bumpDownloads`，买家==owner 跳过结算只计下载；价 0（免费）匿名可用仅 `bumpDownloads`。
>   返回 `{card:{globalId,name,author,source,intro,cardJson,updatedAt}, profile?:{catfood,spentTotal}}`
>   （card_json 只在此交出，浏览列表仍不含）。
> - `POST /:id/rating`（`requireAuth`，`{value:1|-1|0}`）：事务内 value 0 删 rating 行 /
>   否则 `INSERT OR REPLACE`，`recountRatings` 从 ratings 表重算 likes/dislikes 写回该行；
>   返回 `{likes,dislikes,myValue}`。
> - `GET /mine/ratings`（`requireAuth`）：返回 `{ratings:{[globalId]:value}}`，库打开时
>   登录态预载激活态。路由 `/:id/...` 与 `/`、`/tags`、`/covers` 不冲突，**无需改 server.js/
>   nginx/db schema**（ratings 表阶段 0 已建）。
> **前端**：`lib/sharedLibraryApi.ts` 把内部 `request` 扩展支持 method/body/token（GET 不变），
> 新增 `acquireCharacter(token|null,gid,mode)` / `rateCharacter(token,gid,value)` /
> `fetchMyRatings(token)` / `fetchCoverBlob(gid)`（封面失败返 null，卡仍可无封面入库）；
> **不动** sharedAccountApi / sharedCharacterApi。`SharedPaymentModal.tsx`（BaseModal+portal，
> mode 决定两段文案=设计 129-130 使用 / 143-144 买断，余额 `<价`红字、购买 `余额<价||busy`
> 禁用）。`SharedLibraryModal.tsx`：LibraryCard 加动作区（**使用** 免费=绿直接获得·付费→
> 登录校验→支付界面；**买断** `buyoutPrice>0` 才显示→登录→支付；**好评/差评** 激活绿/红·
> 可取消可切换·未登录引导登录）；使用流程=卡槽校验→`acquireCharacter`→`convertSillyTavernCharacter`
> 转卡+设 `shared/globalId/author/source/intro/version`+拉 `/covers` 存 `saveCover`→`onUse`；
> 买断流程=`acquireCharacter`→`convertSillyTavernCharacter` 转**完全私有卡**(无 shared)→`onBuyout`；
> 付费成功 `saveStoredAccount` 更新本地余额；评价乐观更新 + 401 清登录态引导重登。
> `CharacterSelectionModal`：`onUse` 加卡+设 currentCharacterId+关栈（=开新对话）、`onBuyout`
> 仅加私有卡留列表；私有列表条目按钮显示**不动**（治理留阶段 5）。
> **两个硬骨头（已解决）**：
> 1. **登录引导层叠**：父级 `UserAccountModal` 内联渲染在 app 树，而 `SharedLibraryModal`
>    用 `createPortal(document.body)` 挂 body 根、永远在其之上→登录弹窗被库盖住不可点。
>    JSX 顺序调整无效（库经 portal 逃逸）。改为**库自管登录**：库内嵌一个 `UserAccountModal`
>    作为其 portal 子树最后兄弟，自然在顶层；关闭时 `syncSession` 刷新会话+评价激活态。
> 2. **评价激活态被迟到响应覆盖**：打开时 `fetchMyRatings` 异步响应可能在评价点击之后
>    才落地，覆盖乐观更新（计数对但按钮激活态错）。加**单调序列号** `ratingSeq`：每次
>    评价乐观更新 / 库开关都 `++`，`loadMyRatings` 回调只在 seq 未变时应用，否则丢弃。
>    （`rate` 只读 token 不再触发 ratings 重拉。）
> **坑（测试方法）**：`INSERT OR REPLACE INTO users` 会触发 sessions 表 `ON DELETE CASCADE`
> 删掉该账号会话→localStorage token 失效→评价 401。重置 demo 须用 `UPDATE users`，勿
> `INSERT OR REPLACE`。
> 真机验证（rebuild-shared + rebuild 双重启后，:3095 同源 Playwright，登录买家 demo_p4_buyer
> 余额 200）：三卡动作按钮全渲染（免费卡绿色使用·无买断；付费卡使用36+买断100；高价卡使用500）；
> 未登录点评价→登录引导（库内顶层可点）→登录→关闭刷新会话；登录后好评激活（计数1·绿）；
> 买断付费猫娘(100)→支付界面(买断文案/余额)→购买→结算 200→100、私有卡入列(shared:false·无
> globalId)、下载+1；余额不足高价(500)→红字余额+购买禁用；付费使用付费猫娘(36)→支付→购买→
> 结算 100→64→shared 卡入列(shared:true·globalId·version)+设 currentCharacterId+关栈→新对话
> first_mes；评价差评→好评切换→取消（DB value -1→1→删·likes/dislikes 精确·UI 激活态
> bg-green/red-500/15 准确）；免费使用→直接获得(无支付)+shared 卡+新对话+下载+1；卡槽满
> (slotMax 改 1<shared 2)→拦截「共享卡槽已满」无 acquire 请求；stale token 点评价→401→清
> 登录态弹登录引导。后端 DB 核对：买家 catfood 64/spent 136、作者 catfood 136/earned 136、
> 下载/好评/差评/ratings 全精确。本功能代码零 error（仅 demo 卡无封面 404 占位兜底 + JS-Slash-Runner
> 既有 error，均无关）。tsc+eslint 干净。demo 数据已清（demo_p4 账号 CASCADE 删卡/评价/会话、
> 测试浏览器 localStorage 仅留猫娘），**保留 nyaa 真实账号**。

### 阶段 5 — 私有列表中的共享卡　【已完成（5a；作者编辑/发布更新拆 5b）】
`共享` tag、无编辑/导出、`更新`按钮+版本角标提示、已删除提示、删除-卡槽-1；作者本人可见编辑/删除。

- [x] 后端 `src/routes/characters.js`：`POST /characters/versions`（批量版本，不计 downloads）+ `GET /characters/:id`（只读完整卡，404=已删除，不计 downloads）
- [x] 前端 `lib/sharedLibraryApi.ts`：`fetchVersions(ids)` + `fetchCharacterCard(gid)`
- [x] `CharacterSelectionModal`：共享卡分流渲染（共享 tag / 更新+角标 / 删除，无编辑·分享·导出）+ 打开列表批量更新检测 + 更新流程（保留本地 id）+ 已删除提示 + 删除-槽

> 阶段 5 边界（已与用户拍板）：
> 1. **作者本人编辑/发布更新拆到阶段 5b**（设计 150-152：进编辑界面、保存改"发布更新"写回服务器、
>    导出改导入）。本期对**所有** `shared` 卡统一按"使用态共享卡"治理，不做作者本人判别——
>    因使用态本地只存 `author`（显示名）+`globalId`，**未存 `owner` 账号**，显示名比对不可靠
>    （改名/重名失真）；5b 需后端在更新检查响应回带 `owner` 供与登录账号比对。
> 2. **更新端点用批量版本 + 只读取卡两���点**（不复用 acquire——acquire 会 `downloads+1`，
>    更新/角标检查不应计下载）。
>
> 阶段 5（5a）落地（2026-06-17）：
> **后端** `src/routes/characters.js` 在既有端点上新增两个**公开只读**端点：
> - `POST /characters/versions`（body `{ids:[...]}`，hex 过滤+去重+≤200 兜底）→
>   `{versions:{<gid>:updated_at}}`，只回存在的 id；**absent=已删除**（客户端据此判删除）。
>   一次请求拿全部持有共享卡的服务器版本（不逐卡打 N 次）。**不计 downloads**。
> - `GET /characters/:id`（hex 校验）→ `{card:{globalId,name,author,source,intro,cardJson,updatedAt}}`，
>   `404 not_found`=已删除。与 acquire 返回同形 card **但不 bump downloads、不结算**，仅供"更新"取最新卡。
>   注册在 `GET /tags`、`GET /mine/ratings` **之后**（Express 顺序匹配，避免 `/:id` 吞字面路由），
>   handler 内 hex guard 二保险。`POST /versions`（单段）与 `POST /:id/acquire`（双段）不冲突。
>   **无需改 server.js / nginx / db schema**。
> **前端**：`lib/sharedLibraryApi.ts` 加 `fetchVersions(ids)`（POST）+ `fetchCharacterCard(gid)`
>   （GET，复用 `AcquiredCard` 类型，`kind:"error"`+`status 404`=已删除）；**不动** account / share 两 api。
>   `components/CharacterSelectionModal.tsx`（核心改造）：
> - **条目按 `character.shared` 分流**：共享卡=角色名后紫色「**共享**」tag + 动作区「更新」
>   (`RefreshCw`=arrows-rotate，替代原编辑位)+「删除」，**无分享·无编辑**（杜绝进编辑界面/导出 json，
>   落实作者权益）；私有卡=分享+编辑+删除（保持原状，零回归）。
> - **打开列表批量更新检测**：`useEffect([isOpen, settings.characters])` → 取所有
>   `shared && globalId` 卡 → 一次 `fetchVersions` → `serverVersion > (local.version ?? 0)` 标记
>   `updateStatus[gid]="update"`（更新按钮右上角**橙色亮点角标**，绝对定位不靠 display/flex 切换，
>   不触 JS-Slash-Runner Tailwind 覆盖）；**absent=已删除→不显角标**（符合设计：留着能用、点更新才告知）。
> - **更新流程**：点更新 → `fetchCharacterCard(gid)` → 404 toast「该角色已从共享角色库删除，无法更新。」；
>   成功 → `convertSillyTavernCharacter` 重转卡，**保留原 local id**（对话绑定 id，绝不换）、重设
>   `shared/globalId/author/source/intro/version(=新 updatedAt)`、重拉 `/covers` 存回**同一 IndexedDB id**、
>   写回 `settings.characters`、清角标、成功 toast。
> - **删除共享卡**：复用既有删除流程（`deleteCover`+filter+`ConfirmDialog`）；卡槽占用是客户端
>   `filter(shared).length`，删后自然 -1，无额外逻辑。确认文案为共享卡补「删除后账号共享卡槽占用 -1」。
>   保留 `length>1` 与"非当前选中"既有 guard。
> - 新增轻量内联 `notice`（绿/红 banner，3s 自动消失）承载更新成功/失败/已删除提示（本组件原无 toast）。
> 真机验证（rebuild-shared + rebuild 双重启后，:3095 同源 Playwright，登录态 demo_p5 使用免费测试卡入私有列表）：
> 私有卡「猫娘」分享+编辑+删除·无 tag（零回归）；共享卡紫色「共享」tag·封面从 IndexedDB·仅更新+删除·
> 无编辑分享；服务器 bump v2 后重开列表→更新按钮橙色角标；点更新→描述变 v2·角标消失·**local id 保持
> 不变**(b921615b…)·version=服务器 updatedAt·封面重入库；服务器删卡后点更新→红色 toast「该角色已从
> 共享角色库删除，无法更新。」(50ms 内出现)·本地卡保留可用；删除共享卡→确认文案含"卡槽占用 -1"→
> 确认后卡清除·sharedCount 1→0。console 仅 JS-Slash-Runner 既有 `parentNode` error + 预期的
> `GET /characters/:id` 404（删除检测命中，浏览器记为 resource 404，非 JS 异常），本功能零 error。
> tsc+eslint 干净。demo 数据已清（demo_p5 账号 CASCADE 删 session、卡/封面早已删尽、浏览器登录态+测试
> 卡清除），**保留 nyaa 真实账号**，临时文件/截图删尽。

### 阶段 5b —（后续）作者本人编辑 / 发布更新
作者对自己上传的共享卡可见「编辑」「删除」：编辑=进编辑界面、保存改"发布更新"写回服务器、导出改导入。
需后端新增鉴权更新端点（`PUT /characters/:id` owner 校验）、更新检查响应回带 `owner`、使用态本地存 `owner` 账号供判别、编辑界面分流 + 分享界面预填复用。

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
- 兑换码充值猫粮 — 仅 UI 占位（阶段 4 起这是唯一未真实结算的环节）

> 注：使用权 / 买断付费在**阶段 4 已改为真实结算**（余额够即扣费、作者收款），不再占位；
> 仅猫粮**充值**（兑换码）侧仍占位待阶段 6。
