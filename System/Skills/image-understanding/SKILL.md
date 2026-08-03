---
name: image-understanding
description: Analyze user-uploaded images and screenshots for visual description, OCR, visible errors, interface state, diagrams, or direct questions about image content. Use when the task requires inspecting pixels rather than reading a document container. 适用于分析用户上传的图片、截图、可见报错、界面状态、图表或执行 OCR。
---

# Image Understanding

Use `ImageAnalyze` with the exact upload URI supplied by the runtime.

- State a concrete visual `task`.
- Include `question` when the user asks for a specific fact.
- Report only visible evidence and preserve uncertainty.
- Do not use this workflow for non-image attachments.
