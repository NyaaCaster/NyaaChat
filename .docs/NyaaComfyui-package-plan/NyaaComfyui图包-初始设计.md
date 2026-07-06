# 设计目的
我想给 NyaaChat 增加一个付费项目 `NyaaComfyui图包` 。
- NyaaComfyui图包 是在 NyaaChat 中使用生图模型供应商 NyaaComfyUI 节点生成图片时的用户账号可用次数额度。
- NyaaComfyui图包 剩余次数不足时不允许使用 NyaaComfyui 节点生图。

## 业务设计
- NyaaComfy 节点生图只能在账号登录后使用
- NyaaComfyui图包 是新增付费项目，需要在 NyaaChat 和 NyaaAcount 两侧都注册付费项目事件
- 用户账号的权限记录中增加 NyaaComfyui画图使用剩余次数 记录值
- NyaaComfyui图包 初始免费额度为10次，扩容价格为：每次扩容 5猫粮，次数+30
- 用户使用 NyaaComfyui 节点进行图片生成时，每次生成成功（返回图片），剩余次数减1，失败（未返回图片）不扣减
- 注意：只有本项目实例特有 NyaaComfyui 节点生图才进行 NyaaComfyui图包计费，QinyAPI节点和用户自定义的任何openai兼容节点与自定义comfyui节点都不进入 NyaaComfyui图包 计费。

## UI
- 共享账号 界面追加条目 NyaaComfyui图包 ，显示 剩余次数 和 扩容 按钮，扩容按钮逻辑同其他扩容项目的扩容按钮逻辑，用于付费直接增加 NyaaComfyui图包 的剩余次数。
- 生图模型供应商 NyaaComfyUI 节点 的界面中，在 连通性检查 后方加一个 `图包剩余` ，用于显示剩余生图次数数值（注意不要用 已用/上限 的方式显示，只显示剩余次数）。在剩余次数背后加一个`扩容`按钮，逻辑同 共享账号 界面 NyaaComfyui图包 条目的扩容按钮。
- 生图模型供应商 NyaaComfyUI 节点 的界面中，NyaaComfyUI 节点启用开关从关闭状态改为启用状态，需要检查是否在账号登录状态，已经登录可以开启，如果未登录，打开账号登录界面。
- 对话界面中，对话气泡中的 基于此消息生成图片 功能，点击时要进行判断：
    - 如果使用的不是  NyaaComfyUI 节点 ，按照正常流程进行
    - 如果使用的是  NyaaComfyUI 节点 ，按以下条件判断：
        - 如果处于未登录状态：打开登录界面
        - 如果处于登录状态，检查 NyaaComfyui图包 剩余次数：
            - 如果图包剩余次数大于0，进行生图流程，生成后 NyaaComfyui图包 剩余次数 -1.
            - 如果图报剩余次数小于等于0，弹窗告知"NyaaComfyui图包 剩余次数不足，是否要扩容？" 选择 取消 关闭弹窗，选择 扩容 ，打开 共享账号界面。
