# 共享契约与模块边界

跨端数据应只有一个权威定义。先复用现有契约与生成流程，避免为同一种数据维护第二份类型或运行时规则。

## 交互输入

`Source/AgentSystem/Core/AgentInteractionInputContract.ts` 定义表单字段、操作、模式和请求/解决事件载荷，不依赖 Node、React 或运行时服务。

后端交互运行时和领域事件直接使用该契约。`npm run generate.frontend-events` 将完整契约同步到 `Frontend/src/api/generatedInteractionInputContract.ts`，前端原入口只保留类型别名。`npm run verify.frontend-events` 同时检查这些产物，新增字段后不需要手工同步前端类型。

表单与链接是按 `mode` 区分的联合类型。修改事件投影时保留这一关联，不对整个联合类型使用会丢失分支字段的普通 `Omit`。

## 配置迁移

`AgentConfigMigrationRetirements.ts` 的迁移表显式声明目标版本与步骤。每一步先处理根配置，再处理有效的 `Defaults` 对象；路径记录仍分别使用空前缀与 `Defaults.`。

迁移版本不必连续，例如已有的 `36 → 38`。不要根据表的下标推导版本，也不要为未知版本自动跳过步骤。外层迁移器负责拒绝缺失的迁移。

## 私有 JSON 接口

`AgentPrivateJsonHttp.ts` 统一密钥接口的响应头、JSON 错误、CORS 与 GET/OPTIONS 处理。身份认证仍由宿主路由负责，具体接口仍负责字段权限和密钥读取。

成功和错误响应都禁止缓存。无法解密的已存密钥返回 `secret_unresolved`，不能伪装成空值交给设置表单保存。

## 主题

`basePalette.ts` 只共享所有主题一致的值，其余颜色由各主题显式声明。公共 token 完整性和强调色 token 名称由 TypeScript 校验；新增独立 token 后必须补齐主题覆盖。

重构只改变数据组织，保留现有颜色、阴影和透明度。按照 [Ladle 约束](./FrontendLadleConstraints.md) 验证主题和实际组件，不根据目标行数推导色值。

## 浏览器与渠道

`AgentManagedBrowserProfile.ts` 负责共享浏览器配置目录的租约、重启和标签页变更串行化；`AgentNativeBrowserCommand.ts` 负责原生进程、命令预算、取消和响应解析。驱动继续负责会话归属、导航和下载授权。

`AgentChannelConversationGuard.ts` 负责清空会话时使旧异步工作失效；清理失败也不能重新启用旧工作。`AgentChannelServiceHelpers.ts` 保留授权判断、附件投影等无状态逻辑，服务负责业务编排。

平台协议不因都有“重连”就共享状态机：Discord Gateway ACK 与 Telegram 长轮询是不同的协议。共享可组合的传输能力，分别维护协议生命周期。
