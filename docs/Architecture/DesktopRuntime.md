# 桌面运行时

## 1. 启动与模块加载

Electron 主进程负责窗口、托盘、IPC 和更新；工作区服务运行在 `utilityProcess` 中。服务启动与窗口初始化并行，服务就绪前显示本地启动页，避免空白窗口。启动页不引用网络资源，支持系统深浅色与减少动效设置，并有直接加载真实 HTML 的 Ladle 预览。

`Build/BundleDesktopServer.ts` 将编译后的应用模块图收敛到 `Dist/Apps/Desktop/DesktopServerProcess.bundle.mjs`。所有第三方包使用 esbuild 的 `packages: external` 保留包边界，原生加载器、动态解析与工作线程仍从原包加载，无需维护原生包白名单。应用自身的 `import.meta.url/dirname/filename` 通过 AST 改写为相对原模块的锚点，同目录资产和子进程路径不随打包移动。

打包该 bundle 必须处理三件事，改动时不要绕开：

1. **模块锚点**：`import.meta.url`、`__dirname`、`__filename` 在打包后指向 bundle，会让同目录资产（endpoints/form JSON、sandbox `contract.json`、OPA policy、guardrail profile 等）和 supervisor 路径失效。构建期用 TypeScript AST 改写为 `__seneraModuleUrl/File/Dir("<原模块相对路径>")`，运行时按 bundle 目录还原；声明了自己 `__dirname` 的模块（如 `pi-coding-agent/dist/config.js`）按局部绑定处理，不参与改写。
2. **原生包 external**：`better-sqlite3`、`@node-rs/jieba`、`@parcel/watcher`、`@lydell/node-pty`、`koffi`、`sqlite-vec`、`sharp`、`ssh2`/`cpu-features`、`@napi-rs/canvas`、`@boundaryml/baml`、`@silvia-odwyer/photon-node`、`@agent-context/sift`、`@zavora-ai/computer-use-mcp` 及 `jiti`（运行时解析用户文件）按各自目录加载二进制，内联即失效。
3. **CJS 互操作**：bundle 顶部注入 `createRequire`（`yaml` 等包会动态 `require`）。

缓存记录实际依赖图，并对输入内容、打包器、锁文件和 TypeScript 配置计算摘要；输入修改或删除会触发重建。构建检查同时验证摘要和锚点目标。

## 2. 窗口和通信

主窗口、设置窗口与 Senera QQ 独立窗口复用当前工作区服务。IPC 的生产实现分别位于 `Main.ts`、`Preload.ts` 和前端 `desktopBridge.ts`；修改时需同步现有桌面 E2E 宿主。

正式版主窗口和设置窗口从已就绪的本地服务 HTTP 同源入口加载，共用 WebSocket、认证和资源链路；仅启动页在服务就绪前读取本地文件。开发模式保留显式配置的 Vite 入口。来源校验不接受任意 `file://` 或 `null` 来源。

窗口保留 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。外链使用统一的外部 URL 策略，设置窗口保留现有就绪握手和未保存修改确认。

### 2.1 IPC 契约

桌面 IPC 面在源码里有四份手写副本：`Apps/Desktop/Main.ts` 的 handler 与 `webContents.send`、`Apps/Desktop/Preload.ts` 暴露的方法、`Frontend/src/app/desktopBridge.ts` 的 `SeneraDesktopBridge`、以及桌面 E2E 的假 main（`Scripts/BrowserE2ETests/DesktopJourney/electronDesktopHarness.cjs`）。`SeneraDesktopBridge` 的方法全是 optional，`ipcRenderer.invoke` 返回 `any`，所以 TypeScript 无法发现只在单侧存在的 channel。

`Scripts/VerifyDesktopIpcContract.ts`（platform suite）用 AST 比较这四份面并断言：

- main `handle` 的 channel 集合 == preload `invoke` 的 channel 集合；
- main `webContents.send` 的 channel 集合 == preload `on`/`removeListener` 的 channel 集合；
- 假 main `handle` 的 channel 集合 == 真实 main `handle` 的 channel 集合；
- preload 暴露的成员集合 == `SeneraDesktopBridge` 声明的成员集合；
- 任何非字符串字面量的 channel 直接失败。

新增或改名 channel 时四处必须同步；`Preload.cjs` 由 `Build/CopyRuntimeAssets.ts` 从 `Preload.ts` 用 esbuild 生成，不再有只编译不运行的假源。窗口 IPC 校验 sender，这里要守的是契约一致性，不是任意代码执行。

### 2.2 用默认应用打开资源（`senera:file.open-external`）

浏览器里预览不了的文件（docx、xlsx、压缩包等）只能靠系统默认应用打开，桌面端为此提供一条固定边界的通道：

- renderer 用自己已认证的会话 `fetch` 取回资源字节，再把 `{ name, bytes }` 交给 main（`Frontend/src/app/desktopBridge.ts` 的 `openFileWithDefaultApp`）；
- main 只做两件事：把字节写进 `%TEMP%\senera-opened-files\<安全文件名>`，然后 `shell.openPath`（`Apps/Desktop/DesktopExternalOpen.ts`，上限 64 MiB，`readDesktopExternalOpenRequest` 拒绝空载荷与非字节载荷）；
- 文件名按 `path.basename` 收敛、过滤控制字符与 `<>:"/\|?*`、限长 100 字符并保留扩展名、避开 Windows 保留设备名，因此资源名无法把文件写到临时目录之外；同名资源每次重写同一个文件，不累积副本。

main 不替 renderer 发网络请求、也不接收工作区路径，所以这条通道既不能变成请求伪造，也不暴露宿主文件系统。web 端没有该 bridge 时按钮不渲染，下载仍是唯一出口。

## 3. 打包与发布链

`npm run desktop.pack`（`Apps/Desktop/PackageDesktop.ts`）是唯一的打包入口：编译源码和前端、准备原生模块与 MCP 运行时，再通过 `electron-builder` 生成安装包。

```text
npm run build → 前端构建 → desktop.prepare-native → desktop.prepare-mcp-runtime
→ electron-builder（安装器）
```

`.github/workflows/release.yml` 的 desktop job 只调用 `npm run desktop.pack -- --frontend-built`；随后检查安装包、差分更新文件（`.blockmap`）与 `latest.yml` 齐全，生成 `Release/senera-update.json` 更新清单，再上传产物。`package.json` 的 build target 只有 Windows NSIS，所以 Darwin 分支不算「已存在的发布缺陷」，除非真的产出 macOS 包。

开发模式的渲染路径要与打包版一致：`npm run desktop.live` 按源码与构建状态判断是否需要增量编译，诊断 GPU 开关通过 `SENERA_DESKTOP_DIAGNOSTIC_GPU` 显式开启。开发版有独立标记，正式版不展示。

原生模块走 N-API 预编译产物，不按 Electron ABI 重建：`Build/PrepareElectronNativeModules.ts` 按 Electron 版本/平台/架构 staging，`Build/ElectronAfterPack.cjs` 注入 `app.asar.unpacked`，`package.json` 固定 `npmRebuild: false`、`afterPack`、`asarUnpack`。staging 缺失时 `afterPack` 直接抛错，所以 `desktop.prepare-native` 不能从打包链里省掉。

## 4. 恢复与诊断

- 渲染进程意外退出后原地恢复，保留 URL 中的工作区和设置位置；正常退出不触发恢复。
- 每个窗口最多在 60 秒内自动恢复 3 次，超过限制停止重载并写入日志，避免持续刷新。窗口销毁时清理计数。
- 本地 crashReporter 不上传报告，启动日志记录转储目录。
- 主进程未捕获异常通过统一的进程保护器记录并尝试关闭工作区服务。
- 服务就绪后写入工作区的 `desktop.session`；成功停止服务后清除。下次启动发现残留时记录异常退出。
- 子进程退出、窗口无响应与恢复失败均保留日志。

## 5. 启动耗时基线

唯一口径是 `desktop.log` 的 `desktop ready in Xms server=Xms frontend=Xms`：`server=` 是窗口等 utility process 的时长，`frontend=` 是加载前端文档之后的时长。当前实现与上游打包策略不同，不能直接引用上游的耗时作为本地性能结果。

打包版基线（2026-10-26，本机 Windows 10.0.26200 x64，Electron 42，打包产物实测）：冷缓存首次 `desktop ready in 3490ms server=2811ms frontend=276ms`，热缓存两次 `desktop ready in 2145ms server=1797ms frontend=87ms` 与 `desktop ready in 2164ms server=1822ms frontend=89ms`。同一口径下，单文件打包前是 `desktop ready in 5786ms server=5358ms frontend=172ms`，即 `server=` 从 5.4s 降到 1.8–2.8s。live 模式（Vite dev）的前端项不具可比性，不要用来定预算。

剩余约 2s 的构成与为什么不继续拆：

- pi 栈（`pi-coding-agent`/`pi-ai`/`pi-agent-core` + `typebox`）占打包前模块数的 54%，但 `new AgentPiSubstrate` 只在 `AgentSystemRuntimeCache.acquire()` 时执行（两个调用点都在 async 路径内），启动成本来自**静态 import 边**而非构造时机。
- 单文件 bundle 未开 `splitting`，动态 `import()` 只延后求值、不省解析，31.4MB 的解析成本仍在。
- 因此见效需要同时：拆 bundle 分块、拆 `PiWorkspaceSystemTools` 的同步工具目录契约（顶层用 pi 构造工具定义）、并把配置错误从「启动期同步抛」改成「首个 turn 抛」。最后一条是用户可见的语义变化，需要产品决策，所以当前**接受现状并把 `server≈2s` 记为预算上限**；懒加载的判据点与证据留在[后续改进清单](../Development/FollowUpBacklog.md)第 12 项。

## 6. 验证入口

| 检查                           | 入口                                                                             | suite    |
| ------------------------------ | -------------------------------------------------------------------------------- | -------- |
| IPC 四方契约一致               | `Scripts/VerifyDesktopIpcContract.ts`                                            | platform |
| 模块锚点、缓存和产物           | `Scripts/VerifyDesktopServerBundle.ts`                                           | platform |
| 启动页主题与品牌资产           | `Scripts/VerifyDesktopStartupSurface.ts`                                         | platform |
| 原有路径与前端加载契约         | `Scripts/VerifyDesktopRuntimePaths.ts`、`Scripts/VerifyDesktopFrontendSource.ts` | platform |

## 7. 相关文档

- [工作区宿主](./WorkspaceHost.md)——安装资源与工作区的分离
- [部署与运维](../Operations.md)——安装包、更新与受控浏览器
- [浏览器端到端测试](../Development/BrowserE2ETesting.md)——桌面 E2E 的宿主与断言边界
