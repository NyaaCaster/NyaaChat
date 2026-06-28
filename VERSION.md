## 当前版本：v1.3.8
Github Commit: [cc83987](https://github.com/NyaaCaster/NyaaChat/commit/cc83987508bd1126bb2622826bbea5fe27a3909d)

发布日期：2026-06-28

### 🔧 修复

- 修复用户消息发送附件后，对话气泡内不显示已挂载附件的问题
- 用户历史消息现在会在文本下方显示附件标签，图片附件会额外显示图片预览
- 历史消息中的附件标签不再提供删除按钮，避免误导为仍可编辑的输入区附件

---
## v1.3.7
Github Commit: [b367eb5](https://github.com/NyaaCaster/NyaaChat/commit/b367eb5d716bb00971ed130751c98eca5a12cea9)

发布日期：2026-06-28

### ✨ 新功能

- 规则条目的触发词输入改为逐个添加：输入单个触发词后按 Enter 或点击「添加」即可加入
- 已添加的触发词会显示在输入栏下方，并可单独删除

### 🔧 优化

- ComfyUI 图片尺寸选项新增图标标识，选择时更直观
- 更新 ComfyUI 生图工作流提示效果，提升 Anima2D 与 DarkBeast 真人工作流的出图表现
- 生图提示词不再受文字回复的语言、字数规则影响，避免图片提示内容被误改
- RuleBreaker 检查条目命名更清晰，便于区分不同检查内容
