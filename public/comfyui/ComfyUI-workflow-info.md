> ⚠**注意：** NyaaChat所用工作流必须先在你的ComfyUI服务上至少运行过一次，成功输出图片后，才可在NyaaChat中使用。
> 
> Windows下建议使用 🌐 [ComfyUI Portable(便携版)](https://docs.comfy.org/zh/installation/comfyui_portable_windows) 部署。

## 下载工作流文件
- 📥 [Anima2D](/comfyui/Anima-Nyaa.json)（Anima-Nyaa.json）
- 📥 [DarkBeast真人](/comfyui/DarkBeast-Nyaa.json)（DarkBeast-Nyaa.json）

## 下载模型文件（需翻墙）并按路径放置
- models\unet
  - 📥 [anima_baseV10.safetensors](https://civitai.com/api/download/models/2945208?fileId=2824391)
  - 📥 [darkBeast_dbzit9DIMRclaw.safetensors](https://civitai.com/api/download/models/2788849?fileId=2675133) 
- models\text_encoders
  - 📥 [anima_baseV10_txt.safetensors](https://civitai.com/api/download/models/2945208?fileId=2824387) 
  - 📥 [zImageTurbo_turbo_txt.safetensors](https://civitai.com/api/download/models/2442439?fileId=2333513) 
- models\vae
  - 📥 [qwen_image_vae.safetensors](https://civitai.com/api/download/models/2945208?fileId=2824385)
  - 📥 [ae.sft](https://civitai.com/api/download/models/2699886?type=VAE&format=SafeTensor)
- models\loras
  - 📥 [anima-turbo-lora-v0.2.safetensors](https://civitai.com/models/2560840/anima-turbo-lora?modelVersionId=2979642)

## 运行工作流
- 刷新或重启ComfyUI
- 载入下载的工作流文件
- 运行后 `成功出图` 即可