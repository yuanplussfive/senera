---
name: image-generation
metadata:
  senera:
    icon: image
description: Generate images from descriptions, edit existing images using references, or apply a mask when the configured image model supports it. 生成插画、封面、产品图或根据参考图编辑图片。
---

# Image generation and editing

Use `ImageGenerate` for image creation and editing. `ImageAnalyze` inspects images.

- Read `ImageModels` when choosing a model or when editing capabilities are unknown. Use an exact configured model ID. Do not infer protocols or editing support from a model's name.
- Write a self-contained prompt with the subject, composition, style, requested changes and details to preserve. The image model does not receive the conversation.
- For reference editing, supply `images` with exact resource sources from uploads or earlier tool results. Multiple inputs remain in their supplied order. Ask explicitly which parts to preserve or replace.
- Masks are optional and require a model declaring mask support. Supply a local PNG mask whose transparency and dimensions match the first reference. Do not invent or silently resize masks.
- Image options belong to the selected protocol. `openai-images` accepts `size`, `quality`, `n`, `outputFormat`, `outputCompression`, `background` and `moderation`. `openrouter-images` accepts `aspectRatio` and `imageSize`. Leave unspecified options absent; the provider validates its supported values.
- Independent requests may run concurrently through Codemode. For variants of one prompt, use `n` when the selected protocol supports it.
- In Codemode, discover the image tools and read their current schemas with `describeTool`. Call `tools.ImageModels({})` to list configured choices and `tools.ImageGenerate(args)` to generate or edit. The returned `images` array contains saved resource sources; keep those small references when selecting or storing results. The host supplies model credentials, records usage and publishes each image.
- Results contain saved image resources. Use those exact references for preview, further edits, or channel media delivery. Never print Base64 or invent a remote image URL.
- A successful HTTP response without an image is a protocol failure. Inspect the reported error before retrying; never automatically switch models or endpoints.
