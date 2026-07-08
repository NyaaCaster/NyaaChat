---
name: update-comfyui-workflow-info
description: Update NyaaChat/public/comfyui/ComfyUI-workflow-info.md when ComfyUI models or workflows change. Cross-references download history, providers.ts workflow registry, and non-API workflow JSON files to produce accurate model download entries with correct URLs.
---

# update-comfyui-workflow-info

当 ComfyUI 模型或工作流发生变更时，更新 `public/comfyui/ComfyUI-workflow-info.md` 文档。

## 触发场景

- 新增、移除、替换 ComfyUI 工作流（`public/comfyui/*.json` 非 API 工作流文件）。
- `src/lib/providers.ts` 中 `COMFY_WORKFLOWS` 注册表发生变更。
- ComfyUI 本地下载了新的模型文件，更新了 `下载记录.txt`。
- 用户明确要求"更新 ComfyUI 工作流文档"。

## 数据源

按优先级排列：

1. **`src/lib/providers.ts`** — `COMFY_WORKFLOWS` 数组（约 L196-200），定义当前启用的工作流 ID、名称、API 文件路径。这是工作流列表的权威来源。
2. **`public/comfyui/<工作流>.json`**（非 API 版本，文件名不含 `.api.`）— 每个工作流对应的本地 ComfyUI 工程文件。从中提取实际引用的模型文件名：
   - `UNETLoader` 节点 → `unet_name` → 对应 `models\unet\`
   - `CLIPLoader` 节点 → `clip_name` → 对应 `models\text_encoders\`
   - `VAELoader` 节点 → `vae_name` → 对应 `models\vae\`
   - `LoraLoader` 节点 → `lora_name` → 对应 `models\loras\`
3. **下载记录文件**（用户指定路径，如 `G:\ComfyUI_windows_portable\下载记录.txt`）— 模型文件名与下载 URL 的映射。URL 以此文件为准。

## 执行流程

### 第一步：读取数据源

并行读取以下文件：
- `src/lib/providers.ts`（关注 `COMFY_WORKFLOWS` 数组）
- `public/comfyui/ComfyUI-workflow-info.md`（当前版本文档）
- 用户指定的下载记录文件

### 第二步：提取工作流列表

从 `COMFY_WORKFLOWS` 中提取当前有效的工作流。`disabled: true` 或不在数组中的为已废弃。

非 API 工作流文件命名规则：API 文件名去掉 `.api` 即为非 API 版本。例如：
- API 文件 `Anima-Nyaa.api.json` → 非 API 文件 `Anima-Nyaa.json`
- API 文件 `RedMix-Nyaa.api.json` → 非 API 文件 `RedMix-Nyaa.json`

### 第三步：解析每个非 API 工作流文件

读取每个非 API 工作流 JSON，提取模型引用。查找以下节点类型：

| 节点类型 | 字段 | 对应目录 |
|----------|------|----------|
| `UNETLoader` | `widgets_values[0]` (unet_name) | `models\unet` |
| `CLIPLoader` | `widgets_values[0]` (clip_name) | `models\text_encoders` |
| `VAELoader` | `widgets_values[0]` (vae_name) | `models\vae` |
| `LoraLoader` | `widgets_values[0]` (lora_name) | `models\loras` |

（注意：部分工作流可能有多个 LoraLoader，需全部提取。）

### 第四步：匹配 URL

将提取的模型文件名与下载记录中的条目逐一匹配：

- **文件名在下载记录中存在** → 使用下载记录中的 URL。
- **文件名不在下载记录中** → 保留文档中已有的 URL（如存在）；否则标注为无 URL。
- 下载记录中供其他工作流/用途的模型，**不纳入**当前文档。

### 第五步：生成并写入文档

按以下结构重写 `ComfyUI-workflow-info.md`：

```markdown
> ⚠**注意：** NyaaChat所用工作流必须先在你的ComfyUI服务上至少运行过一次，成功输出图片后，才可在NyaaChat中使用。
> 
> - Windows下建议使用 🌐 [Windows ComfyUI Portable 便携版](https://docs.comfy.org/zh/installation/comfyui_portable_windows) 部署。
> - Linux下建议使用 🌐 [ComfyUI Portable(便携版)](https://docs.comfy.org/zh/installation/comfyui_portable_windows) 部署。

## 下载工作流文件
- 📥 [<工作流名称>](/comfyui/<非API文件名>)（<非API文件名>）
- …（每个工作流一行）

## 下载模型文件（需翻墙）并按路径放置

### models\unet
- <工作流名称>
  - 📥 [<模型文件名>](<URL>)
- …

### models\text_encoders
- <工作流名称或"共用"标注>
  - 📥 [<模型文件名>](<URL>)
- …

### models\vae
- …

### models\loras
- …

## 运行工作流
- 刷新或重启ComfyUI
- 载入下载的工作流文件
- 运行后 `成功出图` 即可
```

### 格式约束

- **保持 Markdown 结构不变**：注意事项 → 工作流文件下载 → 模型文件下载（按 models\ 子目录分组）→ 运行说明。
- 模型按目录分组（`models\unet` / `models\text_encoders` / `models\vae` / `models\loras`），每个目录内按工作流细分。
- 多个工作流共用同一模型时，合并在一个条目下，标注"共用"和涉及的工作流名称。
- URL 使用下载记录中的原始链接（civitai / civitai.red / huggingface 等），不做转换。
- 废弃的工作流及其模型条目**必须移除**，不在文档中保留历史信息。
- 工作流名称以 `providers.ts` 中 `COMFY_WORKFLOWS` 的 `name` 字段为准。

## 执行后

- 不需要自动 rebuild — 此文档仅作为用户手动部署 ComfyUI 时的参考，改动不影响前端构建产物。
- 向用户汇报变更摘要：哪些工作流新增/移除、哪些模型条目更新了 URL。

## 不要做的事

- 不要使用 API 版本工作流文件（`.api.json`）来提取模型 — API 版本可能已剥离固定提示词节点，模型加载节点结构与非 API 版本一致，但以非 API 版本为准更可靠。
- 不要在文档中保留已废弃的工作流或模型条目。
- 不要自行推测或编造模型下载 URL — 必须以下载记录文件为准。
- 不要改动文档的整体 Markdown 结构和注意事项。
