# EJS 模板插件 · P6 进行中的交接提示词

> 用途：上一轮对话因输出失控（重复刷屏）而中止，本文件用于**在新对话中无缝续接**。
> 直接复制下面「提示词」整段粘贴给新对话即可。

---

## 提示词（复制这一段）

```
继续 NyaaChat 的 EJS 模板插件（ejs-template）开发 —— P1–P5 已完成并推送，当前在 P6 真机验收的收尾。
请以 plan 模式推进。

## 必读（按顺序）
1. H:\GitHub\NyaaChat\.docs\plugin-system\插件开发_EJS-template\开发计划-SSOT.md  ← 唯一事实来源
   （决策 D1–D16、九条口径、坐标、发现、缺口、教训）
2. H:\GitHub\NyaaChat\.docs\阶段交接-EJS模板插件-P1-P5.md  ← P6 起点、判据表、8 个真问题、9 条纪律
3. H:\GitHub\NyaaChat\dev-server\tools\verify-ejs-review.md  ← t12 终局交叉复核（verdict=pass，F1–F5）
4. H:\GitHub\NyaaChat\.docs\交接提示词-EJS-P6.md  ← 本文件（监控命令 / 判断依据 / 下一步）

## 当前状态（2026-09-18）
- dev 测试机：http://127.0.0.1:4095/ （账号 nyaa，无 Basic Auth；后端指向 macmini 真实容器）
  重建命令：cd H:\GitHub\NyaaChat\dev-server && python tools/rebuild-dev.py --up
- 主仓 origin/master 已推送：98c670f(插件本体) → 60f087b(.dockerignore) → 9f5992b(面板精简)
  → 12526e6(脚本运行器提示) → 384ca48(补句号) → d0130e3(P6 起点文档)
  → f078001(空壳行 .trim 修复) → e27fc8d(matched 跨批去重)
- dev-server 仓 origin/main：2e5cd73(判据脚本+复核报告)、0da516f(golden 基准入库)
- 判据全绿（captain 亲跑）：verify-ejs-engine.ts 两模式 57/57 差异 0；
  verify-ejs-host.ts 49/0；verify-ejs-integration.ts 29/29；npx tsc --noEmit exit 0

## P6 进度
| 判据 | 状态 |
|---|---|
| ① 端到端 + 无 <% %> 泄漏 | ✅ 已证（6 次真实请求 <% 全 0） |
| ② 缓存命中 | 🟡 机制已证（同 prompt 第二次 89% 命中）、跨轮待证 |
| ③ setvar 每轮恰好一次 | ⬜ 待测（需"有写入的轮次"） |
| ④ 抛错降级 | ⬜ 待测（需注入） |
| 浏览器① 开关生效 | ✅ 已证（39 条被渲染） |
| 浏览器② 错误面板可见 | ⬜ 待测（与 ④ 同一次） |
| 浏览器③ 统计一致 | ✅ 已证（39/39、574 块与卡片逐位吻合） |

## 新对话第一件事：重建浏览器控制台监控（后台任务）
用 run_in_background: true 跑下面这段，之后用 job_output 读增量：

$dir = "H:\GitHub\NyaaChat\dev-server\logs\browser"
$seen = @{}
Get-ChildItem $dir -Filter *.ndjson -File -ErrorAction SilentlyContinue | ForEach-Object {
  $seen[$_.FullName] = @(Get-Content $_.FullName -ErrorAction SilentlyContinue).Count
}
Write-Output "[monitor] baseline: $($seen.Count) file(s)"
while ($true) {
  Get-ChildItem $dir -Filter *.ndjson -File -ErrorAction SilentlyContinue | ForEach-Object {
    $p = $_.FullName
    $lines = @(Get-Content $p -ErrorAction SilentlyContinue)
    $n = $lines.Count
    $prev = if ($seen.ContainsKey($p)) { $seen[$p] } else { 0 }
    if ($n -lt $prev) { $prev = 0 }
    if ($n -gt $prev) {
      for ($i = $prev; $i -lt $n; $i++) {
        try { $o = $lines[$i] | ConvertFrom-Json
              $t = ([datetime]$o.at).ToLocalTime().ToString('HH:mm:ss')
              Write-Output "[$t] [$($o.level)] $($o.text)" } catch { Write-Output $lines[$i] }
      }
      $seen[$p] = $n
    }
  }
  Start-Sleep -Seconds 2
}

注意：监控输出里多行 JSON 会被 job_output 折叠，关键判断请直接读 NDJSON 原文（见下）。

## 判断依据（怎么读证据）
日志（dev-server/logs/，主机可直读，不必截图）：
- browser/browser-YYYY-MM-DD.ndjson —— 浏览器控制台，一行一 JSON，字段 at/level/text/sessionId
  · [nyaachat-log:request]  出站请求（含 renderedMessages，但被前端截断）
  · [nyaachat-log:response] 响应（含 usage：prompt_tokens / prompt_cache_hit_tokens / prompt_cache_miss_tokens）
  · [promptText] 条目「…」渲染失败，已降级（内容已丢弃，不进请求体）
    ⚠️ **【2026-09-18 P6 实测更正 · F-P6-1】这条日志形态在当前实现下不会出现**：
    `plugins/EJS-template/plugin.tsx` 两处 `return ""` **吞错并返回空串**，而 `""` 是 string
    ⇒ 宿主认为"渲染成功、结果是空串"。`promptText.ts` 那两条降级分支的触发条件是
    **渲染器抛错** / **返回非字符串**，两者在 ejs-template 下都不成立。
    **实际可见通道 = 插件侧**：控制台 `[plugins:ejs-template] render — 模板错误：条目「…」渲染失败…`
    + 面板「降级条目数 / 最近一次错误」。（P6 两轮实测：插件侧命中 6 条，宿主 `[promptText]` 0 条。）
- nginx/access.log、nginx/error.log

读取技巧（踩过的坑）：
- ConvertFrom-Json 之后换行是真换行 → 正则写 '\[World Info\][ ]*(\n|$)'，不要写 '\\n'
- 请求日志会被前端截断（带 …）→ "41 条是否都进去"必须看面板统计，不能只看日志

面板（设置 → 扩展 → EJS模板）—— 权威数据：
rendered / matched、EJS 块数、耗时、降级条目数、变量写入、turnId

卡片侧交叉验证（应输出：含EJS 41 / enabled 39 / 块数 574）：
python -c "
import json
d = json.load(open(r'H:\GitHub\NyaaChat\.ref\EJS\魔法少女V3.2.6.json', encoding='utf-8'))
es = d['data']['character_book']['entries']
w = [e for e in es if '<%' in (e.get('content') or '')]
en = [e for e in w if e.get('enabled')]
print('含EJS', len(w), 'enabled', len(en), '块数', sum((e.get('content') or '').count('<%') for e in en))
"

## 下一步（P6 收尾）
1. 刷新页面，确认面板「渲染条目数」= 39 / 39（e27fc8d 修的就是它虚高成 39 / 77）
2. 找一张可改的卡，加两条常驻条目、发两轮：
   A: <% throw new Error("ejs-probe") %>
   B: <% setvar('stat_data.__ejs_probe', (getvar('stat_data.__ejs_probe') || 0) + 1) %>probe=<%= getvar('stat_data.__ejs_probe') %>
   期望：降级条目数 = 1 且日志有 [promptText] …渲染失败；
   变量写入第一轮/第二轮各 1；渲染结果 probe=1 → probe=2（跨轮读回，同时验证 D9 闭环）
3. ② 缓存：固定同一 provider（现用 deepseek-flash）连发两轮，
   从 nyaachat-log:response 的 prompt_cache_hit_tokens 看命中比例是否仍高

## 纪律（本轮血泪，务必遵守）
1. 判据脚本可复跑留档，不许"跑完即删的探针"
2. 坐标只取"同一轮输出"（哈希 + 字节数 + mtime + 门禁退出码），不要跨消息拼接
3. mtime ≠ 内容变：只有哈希不同、或能确证写入晚于取证，才算"必须重取"
4. "空"的判定按 trim() 后的内容算（真机踩过：!== "" 挡不住 "\n"）
5. 统计字段口径要与注释一致（真机踩过：matched 注释说去重、实现跨批没去重）
6. 真机测试不可替代 —— 最近两个缺陷都是夹具覆盖不到的形态

## 已知遗留（不影响 EJS）
- plugins/js-slash-runner/plugin.tsx:177 的 icon: "FileCode2" 不在允许集 → 每次渲染 warn + 回退拼图块
  （待选：A 改插件图标 / B 扩允许集）
- 仓库有一个不可达的悬挂提交对象 6421131（t13 模拟提交时留下，无法 push；
  清理需 git gc --prune=now，属仓库级操作，由用户按需执行）
```

---

## 附：本轮已修的两个"真机才暴露"的缺陷（供新对话理解上下文）

| 缺陷 | 现象 | 根因 | 修复 |
|---|---|---|---|
| **空壳行** | `═ 模板设定 ═` 里出现 5–6 行 `[World Info] ` | t10 的过滤是 `!== ""`，挡不住**纯空白**（`"\n"`） | `f078001`：改判 `.trim() !== ""` |
| **`matched` 虚高** | 面板显示 `39 / 77`（卡片只有 39 条 enabled 含 EJS） | `pendingMatchKeys` 每批都被取走并 `clear()` ⇒ 第二批不认识第一批 ⇒ 重复计数（注释声称"按正文去重"） | `e27fc8d`：加 `seenMatchKeys` 跨批去重，只在换轮时清 |
