# ToolContracts 模块

`ToolContracts` 是插件工具参数的生产运行时契约边界。它读取版本化静态契约包，验证 JSON 结构和 JSON Schema，将结果冻结后交给插件注册表。

## 边界规则

- 声明工具的插件必须通过 manifest 的 `Contracts.File` 指向插件根目录内的契约包。
- 契约包必须完整覆盖 manifest 工具，不能缺失或包含额外工具。
- 生产运行时不读取 TypeScript 签名，也不运行 TypeScript 编译器。
- 内置 TypeScript 工具在插件根目录的 `ToolContractSource.json` 显式声明作者源；开发期使用 `npm run generate.tool-contracts` 更新契约，构建通过 `npm run verify.tool-contracts` 校验源码摘要与生成结果。
- 使用 `@senera/tool-plugin-sdk` 的 MCP 插件可从现有 Zod 输入和输出 Schema 生成同一版本的静态契约包。
- 使用 SDK 的外部插件不进入内置 TypeScript 生成器；它们应在自己的构建流程中调用 SDK 生成器并检查产物差异。
- 工具参数在 HostCapability/MCP 分流前统一使用契约中的 JSON Schema 校验。
