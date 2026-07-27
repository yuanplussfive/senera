# 前端性能预算

Senera 使用 Vite manifest 描述构建产物之间的关系，并按用户实际进入的界面验证资源预算。预算的目标是阻止首屏和主要路由在无意间持续膨胀，而不是锁定某次构建生成的哈希文件名。

## 预算组

预算策略位于 `Build/FrontendBundleBudget.json`，由 `Build/FrontendBundleBudget.schema.json` 校验。当前组对应四个真实加载阶段：

| 组                   | 覆盖范围                                                |
| -------------------- | ------------------------------------------------------- |
| `bootstrap`          | HTML、入口脚本、入口样式和它们的静态依赖                |
| `authenticated-main` | bootstrap、鉴权后壳层和聊天工作台                       |
| `web-settings`       | authenticated-main 和网页设置浮层                       |
| `desktop-settings`   | bootstrap、鉴权后壳层和桌面独立设置页，不包含聊天工作台 |

`extends` 表达前一阶段已经下载的资源。验证器使用集合合并资源，因此共享依赖只计算一次。

`bootstrap.requiredAssets` 还要求构建产物至少包含 4 个 `.woff2`。它们分别是 Geist、Fraunces 正体、Fraunces 斜体和 JetBrains Mono 的本地 Latin 可变字体；字体使用 `font-display: swap`，不依赖 Google Fonts。字体文件同时计入 resource count、identity、gzip 和 Brotli 上限，删除或漏打包字体会直接使构建失败。

## Manifest 解析规则

每个 `roots` 条目必须唯一匹配 Vite manifest 的 key、`src` 或稳定的 chunk `name`。优先使用源码路径；仅当 Vite 对动态入口不保留 `src` 时，才使用稳定名称。禁止引用带内容哈希的 `assets/*.js` 文件名。

验证器从每个 root 递归遍历 `imports`，因此静态依赖会自动纳入预算。`dynamicImports` 不会自动遍历：动态模块代表用户尚未进入的功能，只有当它属于当前加载阶段时，才应作为该组的显式 root。这样可以同时避免漏算当前路由和误算尚未触发的编辑器、终端或代码高亮模块。

## 调整规则

执行 `npm --workspace senera-frontend run build` 会生成 manifest、预压缩资源并验证四组预算。修改依赖或路由边界后：

1. 先确认增长来自预期功能，而不是错误的静态导入或重复依赖。
2. 新增用户可独立进入的加载阶段时，新增具名预算组，不把资源塞入现有首屏预算。
3. 只有确认增长合理后才调整上限，并保留约 10% 到 15% 的正常构建余量。
4. 同时检查 identity、gzip 和 Brotli；只看未压缩大小不能代表生产传输成本。

生产构建还会验证所有应预压缩的资源都存在可逆的 gzip 和 Brotli sidecar，避免预算通过但服务端实际只能发送未压缩资源。
