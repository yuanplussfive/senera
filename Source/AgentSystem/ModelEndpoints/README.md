# ModelEndpoints 模块导览

所有运行中的模型生成请求都使用 Pi 供应商适配器；业务功能提供数据和输出契约，不自行实现供应商 HTTP、SSE 或响应兼容解析。

## 阅读顺序

1. `AgentStructuredModelClient.ts`：native 必选 tool call 与正式 BAML 契约的共同入口。
2. `AgentPiModelRequestExecutor.ts`：Pi 请求、配置超时、取消、缓存、用量和耗时。
3. `AgentPiModelRequestProjection.ts`：消息与图片的供应商中立投影。
4. `AgentPiConfiguredProvider.ts`、`AgentNativeToolModelProjector.ts`：配置到 Pi provider/model 的投影。
5. `AgentModelEndpointContract.ts`、`AgentNativeToolApiStreams.ts`：声明的协议路由与 Pi adapter。
6. `AgentLanguageModel.ts`：业务调用的消息、图片与缓存数据契约。

## 供应商流诊断

主对话、Pi 压缩、BAML 和辅助模型共用 `Diagnostics/AgentProviderStreamDiagnostics.ts`。
采集 Pi 的 `onProviderStreamEvent`，不替换供应商传输或解析器。每次实际供应商调用只生成
一条 `pi.provider.stream_summary`，记录配置模型、实际 provider/API/model、耗时、结束状态、
事件计数、用量与工具调用 ID。结构化输出校验失败与供应商请求失败分别记录。

前台请求通过异步作用域携带 session/request/step，工具内的模型请求增加 toolCallId。
后台学习使用自己的持久请求 ID 和来源 session，避免关联到已经结束的前台请求。
缺失的身份保持缺失，不从缓存名称推断会话。修复与重试的每次实际调用都有独立 providerRequestId，
并保留业务 invocationId。采集不到原始事件时计数为 0，不拿规范化流事件冒充原始事件。

普通模式只保存摘要。设置 `SENERA_LOG_EVENTS=verbose` 后保存经过脱敏的事件结构，
首尾采样受 `Persistence.Logs.DetailMaxBytes` 限制。正文、图片、参数字符串及敏感键不保存；
字符串可能跨事件拆分，不能只靠单个片段匹配凭据。工具名称/ID 从 Pi 的规范化工具调用关联，
不为每种供应商维护一份猜测字段规则。
工具结束消息覆盖开始阶段的部分名称与 ID，关联 ID 不按展示文本长度截短。
已知凭据取自实际 API key 和敏感请求头；普通请求头中的短值不参与凭据替换。

详情通过 Artifact 安全文件写入器异步发布到工作区日志的 `details` 目录，复用日志保留与查询机制。
使用 `senera logs trace REQUEST_ID` 找到摘要，再用 `senera logs detail DETAIL_ID` 读取详情。
不发布为对话附件，不广播逐片段前端事件；写入繁忙、禁用、超限或失败均在摘要中标明，
不会改变模型结果。服务关闭时等待已经提交的诊断写入。
详情写入并发由 `Persistence.Logs.DetailMaxConcurrentWrites` 配置，普通摘要独立记录。
发布端再次核对当前日志大小策略；策略收紧时明确返回超限，不把预览或初始化故障当作完整详情。

## API 根路径与 Pi adapter

配置的 BaseUrl 表示供应商 API 根。路径重叠只按完整 URL segment 处理，供应商 payload 和流解析由 Pi adapter 管理。native 和 BAML 使用同一供应商投影。新增协议或升级 SDK 时，需要验证真实 adapter 的最终请求 URL。

新增辅助模型功能请参阅 [公共请求架构](../../../docs/Architecture/AuxiliaryModelRequests.md)；新增协议请参阅 [开发手册](../../../docs/Development/AddModelEndpoint.md)。

## 按调用需求检查能力

模型目录只保存声明，不要求每个模型都能运行 Agent。默认模型绑定、会话启动、
子 Agent 模型池和前端 Agent 模型选择使用同一份规划需求：native 需要文本对话、
工具调用和启用流式输出，BAML 需要文本对话。能力和规划方式独立编辑，互不改写。
已选模型变得不兼容时，界面保留该选择并展示缺少的能力，调用时明确拒绝，
不会清除明确选择后改用默认模型。

`Core/AgentModelCapabilityContract.ts` 是能力键与匹配规则的权威来源，经现有
`generate.frontend-events` 生成前端副本并由同一门禁检查。前端图标和分组可以参考
名称，能力不再从模型名称推断。

辅助请求按实际内容校验：文本需要 Chat，发送图片增加 Vision，声明原生工具或
必选 tool choice 增加 ToolCalling。图像分析不读取规划策略，也不因此要求工具
能力。缺少能力在请求前明确报错，不改变规划方式或替换已指定模型。

## 图像生成与编辑

`ImageGenerate` 与 Codemode 共同调用 `AgentImageGenerationClient`，通过 Pi 的
`Models.generateImages()` 分派。模型声明 `Capabilities.ImageOutput`，再通过
`ImageGeneration.Api` 明确选择 `openrouter-images` 或 `openai-images`。前者复用 Pi
内置适配器；后者在同一 Pi provider 合同下提供 `/images/generations` 和
`/images/edits`。不会按模型名称猜测协议或自动切换端点。

`ImageGeneration.Editing` 声明参考图编辑；`Mask` 仅用于支持遮罩的 OpenAI Images
端点。编辑不要求模型支持聊天或工具调用。图片输入复用图像理解的读取、下载和
规范化服务，遮罩保留原始 PNG，由端点校验透明通道及尺寸。生成结果先发布为资源，
工具只返回可用路径与元数据，Base64 不进入模型上下文或诊断。

在图像系统工具设置中选择默认生成模型，也可以先调用 `ImageModels` 再明确选择。
只有一个可用图像模型时允许省略模型 ID。尺寸等可选参数缺省时由供应商决定，
不维护按模型名匹配的尺寸白名单。供应商没有报告用量时不伪造图片 token 或费用。

原内置 Imagen MCP 已由图像系统工具取代。已有模型需要在模型设置中明确选择图像
协议，再到图像系统工具中选择默认生成模型；原供应商地址、密钥和请求头直接复用。
旧插件的聊天模式无法据此判断是否兼容 OpenRouter 图片协议，因此不自动猜测或迁移。
生成图片按会话持久保存，复用资源配额、预览与会话清理机制。

## Thinking 等级合同

推理能力沿用 Pi 的可移植语义等级：`off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`。模型目录负责声明默认支持集合；模型配置只保存默认等级和可读 Profile，不再暴露供应商原生等级映射。

```json
{
  "ThinkingProfiles": [
    { "Id": "balanced", "Label": "均衡", "Level": "medium" },
    { "Id": "deep-review", "Label": "深度审查", "Level": "high" }
  ],
  "DefaultThinkingLevel": "medium"
}
```

`ThinkingProfiles` 是可读名称到标准等级的一对一别名，运行时仍只向 Pi adapter 传标准等级。模型目录内部的供应商适配信息仍由 Pi 自己维护；用户不需要在每个模型上重复维护一份映射表。

## 图片输入契约

`Capabilities.VisionInput` 是模型端点的图片输入权威声明，而不是按供应商名称推断。未声明时，运行时采用可移植的静态 JPEG、PNG、WebP 基线；上传原件保留不变，发送前可在 Worker 中生成满足 MIME、字节与像素限制的衍生图。

动画能力独立于静态 MIME：`SupportedAnimatedMimeTypes` 必须同时出现在 `SupportedMimeTypes` 中。默认不传递 GIF、APNG、动画 WebP 或动画 AVIF；例如 APNG 必须明确声明为 `image/apng`，不能仅凭 `image/png` 放行。该字段也参与衍生图缓存策略，改变声明不会复用不兼容的旧缓存。
