---
name: document-understanding
description: Read, probe, extract, summarize, or inspect user-uploaded PDF, Office, text, Markdown, CSV, HTML, OpenDocument, and similar document files. Use when a request references an uploaded document, attachment, its contents, metadata, file type, or parsing warnings. 适用于读取、解析、提取、总结或检查用户上传的文档、附件、表格及其内容。
---

# Document Understanding

Use `DocumentExtract` with the exact upload URI supplied by the runtime.

- Use `auto` for normal reading and extraction.
- Use `probe` when only type, MIME, container, or text/binary detection is needed.
- Use `extract` when extraction must be attempted even if automatic selection is inconclusive.
- Base summaries and answers on extracted previews, chunks, metadata, and warnings.
- Use `ImageAnalyze` instead when the upload is an image requiring visual interpretation.
