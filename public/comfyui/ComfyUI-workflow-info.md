# ComfyUI 工作流文件使用说明
> ⚠**注意：** NyaaChat所用工作流必须先在你的ComfyUI服务上至少运行过一次，成功输出图片后，才可在NyaaChat中使用。
> 
> Windows下建议使用 [ComfyUI Portable(便携版)](https://docs.comfy.org/zh/installation/comfyui_portable_windows) 部署。

## 下载工作流文件
- 📥 [Anima2D](/comfyui/Anima-Nyaa.json)
- 📥 真人（尽请期待）

## 下载模型文件（需翻墙）
下载地址：📥 [Anima-base-v1.0](https://civitai.com/models/2458426/anima?modelVersionId=2945208)

> ⚠**注意：** 还需要展开页面中的 `Required Components` 菜单下载 `Text Encoder` 和 `VAE` 文件。

- `anima_baseV10.safetensors` ：放在 `models\unet` 目录下
- `anima_baseV10_txt.safetensors`：放在 `models\text_encoders` 目录下
- `qwen_image_vae.safetensors` ：放在 `models\vae` 目录下
- 📥 [anima-turbo-lora-v0.2.safetensors](https://civitai.com/models/2560840/anima-turbo-lora?modelVersionId=2979642) ：放在 `models\loras` 目录下

## 运行工作流
- 刷新或重启ComfyUI
- 载入下载的工作流文件
- 运行后 `成功出图` 即可