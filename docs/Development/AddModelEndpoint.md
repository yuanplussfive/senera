# 新增模型端点开发手册

模型请求统一交给 Pi；主循环与辅助功能不自行拼供应商 HTTP 请求或解析 SSE。

## 新增辅助模型功能

为功能定义领域提示和严格的 Zod 输出契约，在 `baml_src` 添加对应的 BAML 函数。通过 `AgentStructuredModelClient` 调用即可复用 native／BAML 分流、Pi 请求、结构化修复、配置超时、取消、缓存和统计。不要再增加自己的 JSON 提取器、供应商请求函数或独立重试循环。

native 使用从契约生成的必选 tool call，BAML 使用正式的请求生成器和解析器；BAML 只在本地渲染契约，网络请求仍由 Pi 执行。参阅 [公共请求架构](../Architecture/AuxiliaryModelRequests.md)。

持久学习任务使用后台请求账本的 `runRetried`，由任务管理总尝试预算，并关闭内层请求重试。恢复任务时继续已有次数和重试时间，不能重置为第一次。

## 新增供应商或协议

供应商兼容现有协议时，只配置 base URL、鉴权、headers、模型和能力，不增加供应商品牌专用的端点。现有协议是 Responses、Chat Completions、Claude Messages 和 Google GenerateContent。

只有 wire protocol 实际不同才增加 endpoint kind。优先使用 Pi 已有 adapter，必要扩展集中放入协议契约与 Pi adapter 层。

主要修改位置：

- `Source/AgentSystem/ModelEndpoints/AgentModelEndpointContract.ts`
- `Source/AgentSystem/ModelEndpoints/AgentNativeToolApiStreams.ts`
- `Source/AgentSystem/ModelEndpoints/AgentNativeToolModelProjector.ts`
- 配置类型、schema、defaults 和 form projection；只在用户可见配置改变时同步前端。

供应商负责 API 根、鉴权和 headers，模型负责名字、能力和运行参数。图片数据以 Pi 原生图片块发送，不放入提示文本。Embedding 使用本地 query/document 接口，独立于模型生成请求。

## 验证

协议修改应验证实际 Pi adapter 的请求 URL、headers、多模态内容、工具 schema、取消、首输出超时、请求超时、缓存、用量和失败传播。结构化功能须验证 native 和 BAML 两种模式。

```bash
npm run quality.baml
npm run quality.baml.generate
npm run check.types
npm run test.backend
npm run verify.database-contracts
npx tsx Scripts/VerifyPiModelRequestProjection.ts
```

外部供应商探测保持为显式手动操作，普通 CI 使用 Pi stream 与 adapter 探针，不读取私有配置或发送真实模型请求。
