# DocumentTool

## 简述

按 `uploadUri` 统一处理用户上传文档。工具会先登记并探测文件事实；默认 `auto` 模式会按插件配置选择合适的内容抽取器，继续抽取正文、Markdown 预览、metadata、warnings 和 chunks。

## 何时使用

用户上传 PDF、Word、PowerPoint、Excel、OpenDocument、RTF、CSV、Markdown、HTML、日志、配置、源码或其他可解码文本等文件，并要求读取、总结、分析、提取要点或确认附件类型时使用。

## 不要使用的情况

不要猜测 `uploadUri`。不要传本地绝对路径。图片、截图、照片需要视觉理解时使用 `ImageVisionTool`。

## 输入

- `uploadUri`：附件卡片里的上传句柄，例如 `senera://upload/upl_0123abcd...`。
- `mode`：可选。省略时使用插件 TOML 的 `document.defaultMode`。

## mode

- `auto`：先探测；匹配到插件配置的抽取器时自动抽取正文。
- `probe`：只返回 MIME、编码、ZIP/OOXML 容器等探测事实。
- `extract`：要求抽取正文；如果没有匹配抽取器会返回工具错误。

## 输出

返回上传登记状态、探测事实、容器事实、文本可用性、Markdown 主预览、metadata、warnings 和 chunk 统计。返回内容不包含本地绝对路径。

## 注意

当前上下文优先使用 `markdownPreview` 作为主预览。`textPreview` 和完整 `chunks` 只保存在工具结果 artifact 的 `raw` 引用中；需要更长内容时读取对应 artifact。
