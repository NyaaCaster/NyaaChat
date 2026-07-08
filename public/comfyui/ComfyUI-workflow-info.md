> ⚠**注意：** NyaaChat所用工作流必须先在你的ComfyUI服务上至少运行过一次，成功输出图片后，才可在NyaaChat中使用。
> 
> - Windows下建议使用 🌐 [Windows ComfyUI Portable 便携版](https://docs.comfy.org/zh/installation/comfyui_portable_windows) 部署。 
> - Linux下建议使用 🌐 [Linux ComfyUI Portable便携版](https://github.com/NyaaCaster/ComfyUI_linux_portable_nvidia) 部署。

## 下载工作流文件
- 📥 [Anima2D](/comfyui/Anima-Nyaa.json)（Anima-Nyaa.json）
- 📥 [RM真人·柔美](/comfyui/RedMix-Nyaa.json)（RedMix-Nyaa.json）
- 📥 [DB真人·节操](/comfyui/DarkBeastKrea2-Nyaa.json)（DarkBeastKrea2-Nyaa.json）

## 下载模型文件（需翻墙）并按路径放置

### models\unet
- Anima2D
  - 📥 [anima_baseV10.safetensors](https://civitai.com/api/download/models/2945208?fileId=2824391)
- RM真人·柔美
  - 📥 [Krea2RedMix2.1-INT8-Convrot-ComfyUI.safetensors](https://civitai.com/api/download/models/3086841?fileId=2968503)
- DB真人·节操
  - 📥 [Krea2DarkBeast1.1-INT8-Convrot-ComfyUI.safetensors](https://civitai.red/api/download/models/3091496?fileId=2971080)

### models\text_encoders
- Anima2D
  - 📥 [anima_baseV10_txt.safetensors](https://civitai.com/api/download/models/2945208?fileId=2824387)
- RM真人·柔美 / DB真人·节操（共用）
  - 📥 [qwen3vl_4b_bf16.safetensors](https://huggingface.co/Comfy-Org/Qwen3-VL/resolve/main/text_encoders/qwen3vl_4b_bf16.safetensors?download=true)

### models\vae
- 三个工作流通用
  - 📥 [qwen_image_vae.safetensors](https://civitai.com/api/download/models/2945208?fileId=2824385)

### models\loras
- Anima2D
  - 📥 [anima-turbo-lora-v0.2.safetensors](https://civitai.com/models/2560840/anima-turbo-lora?modelVersionId=2979642)
- RM真人·柔美 / DB真人·节操（共用）
  - 📥 [Detailer-KREA2.safetensors](https://civitai.com/api/download/models/3068874?fileId=2947586)

## 运行工作流
- 刷新或重启ComfyUI
- 载入下载的工作流文件
- 运行后 `成功出图` 即可
