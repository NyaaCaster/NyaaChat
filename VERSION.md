## 当前版本：v1.3.6
Github Commit: [95102d8](https://github.com/NyaaCaster/NyaaChat/commit/95102d8641c4d62b7f59c257c7b7d1dd01ab226f)

发布日期：2026-06-23

### ✨ 新功能

- ComfyUI 生图新增 `DarkBeast真人` 工作流
- DarkBeast 工作流只注入尺寸，不再使用 Anima2D 的画风串

### 🔧 优化

- 画风选择仅在 `Anima2D` 工作流下显示，切换到 `DarkBeast真人` 时自动隐藏
- ComfyUI 工作流说明文档补充 DarkBeast 模型与文件下载说明

---
## v1.3.5
Github Commit: [a085fb1](https://github.com/NyaaCaster/NyaaChat/commit/a085fb164a787c0de3e59417cb13ef6107627560)

发布日期：2026-06-23

### ✨ 新功能
#### 新增 ComfyUI 生图方式
- 可接入 ComfyUI 服务器，按工作流为对话消息生成配图
- 与原有生图方式在对话中以相同方式展示
- 生图供应商新增内置「NyaaComfyUI」服务器
- 支持自行添加「自定义 OpenAI 兼容接口」或「自定义 ComfyUI 服务」
- ComfyUI 生图可选择图片尺寸、工作流与画风
- 提供「测试生成」与服务「健康检查」
- 生图等待时显示排队数与生成进度

### 🔧 优化

- 生图模型设置页重做，支持添加与删除自定义供应商
- 生成的图片下方新增提示文字（图片与情景不符时多因提示词未通过内容审查）
- MCP 工具开关默认全部关闭
- 从绕过设置中移除 ClavisSalomonis 模块