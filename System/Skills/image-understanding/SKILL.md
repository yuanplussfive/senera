---
name: image-understanding
metadata:
  senera:
    icon: image
description: Analyze user-uploaded images and screenshots for visual description, OCR, visible errors, interface state, diagrams, or direct questions about image content. Use when the task requires inspecting pixels rather than reading a document container. 适用于分析用户上传的图片、截图、可见报错、界面状态、图表或执行 OCR。
---

# Image Understanding

Choose the lightest reliable path for the requested visual evidence.

For generating or editing images, read the `image-generation` skill and use `ImageGenerate`.

- When the current model receives an image as native visual input and can answer from it, it may inspect the image directly without a tool call.
- `ImageAnalyze` remains available with the exact resource URI supplied by the runtime when a dedicated visual pass would add value, such as focused OCR, a specific follow-up question, independent verification, or a result that later tool steps need to reference.
- Choose between direct understanding and `ImageAnalyze` from the task, available inputs, and the quality of evidence needed; neither path is mandatory merely because an image is attached.
- For `ImageAnalyze`, supply `images` and one self-contained `prompt`. The visual model does not receive the conversation: include the user's actual goal, relevant prior observations, the precise questions, and the desired language and output format. Description, OCR and comparison are ordinary requests, not separate modes.
- Keep image order explicit when comparing evidence. Ask for exact transcription and mark unreadable regions when reading text; do not substitute a generic description for the user's question.
- Copy the resource URI or workspace path exactly from the attachment/tool result. Resource IDs are opaque; do not derive them from filenames or reconstruct them.
- Report only visible evidence and preserve uncertainty. Do not use this workflow for non-image attachments.
