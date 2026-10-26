# 桌面运行时（Electron）

本文记录桌面端在架构上必须保持的边界：进程划分、IPC 契约、打包与发布链、崩溃恢复，以及启动成本的预算口径。它是约束文档，不是路线图；改动桌面端时先读这里。

## 1. 进程边界

- main 进程只负责原生窗口、托盘、IPC 与更新，不承担 server 的模块图与同步初始化。
- server 运行在 Electron `utilityProcess` 中（`Apps/Desktop/DesktopServerHost.ts`），窗口在 server 就绪前只显示启动画面，不阻塞主进程的事件循环。
- server 的入口是**单文件 bundle**：`Build/BundleDesktopServer.ts` 用 esbuild 把 `Dist/Apps/Desktop/DesktopServerProcess.js` 打成 `Dist/Apps/Desktop/DesktopServerProcess.bundle.mjs`，`Build/CopyRuntimeAssets.ts` 在 `tsc` 之后调用它，`DesktopServerHost` fork 该文件。加载 ~5000 个模块的成本（`server=` 5.1–5.4s → 1.8–2.4s）主要来自按模块计费的解析，而不是读文件。

打包该 bundle 必须处理三件事，改动时不要绕开：

1. **模块锚点**：`import.meta.url`、`__dirname`、`__filename` 在打包后指向 bundle，会让同目录资产（endpoints/form JSON、sandbox `contract.json`、OPA policy、guardrail profile 等）和 supervisor 路径失效。构建期用 TypeScript AST 改写为 `__seneraModuleUrl/File/Dir("<原模块相对路径>")`，运行时按 bundle 目录还原；声明了自己 `__dirname` 的模块（如 `pi-coding-agent/dist/config.js`）按局部绑定处理，不参与改写。
2. **原生包 external**：`better-sqlite3`、`@node-rs/jieba`、`@parcel/watcher`、`@lydell/node-pty`、`koffi`、`sqlite-vec`、`sharp`、`ssh2`/`cpu-features`、`@napi-rs/canvas`、`@boundaryml/baml`、`@silvia-odwyer/photon-node`、`@agent-context/sift`、`@zavora-ai/computer-use-mcp` 及 `jiti`（运行时解析用户文件）按各自目录加载二进制，内联即失效。
3. **CJS 互操作**：bundle 顶部注入 `createRequire`（`yaml` 等包会动态 `require`）。

`Scripts/VerifyDesktopServerBundle.ts`（platform suite）检查 bundle 存在、不比 `tsc` 产物旧、且每个锚点都落在真实路径上。

## 2. IPC 契约

桌面 IPC 面在源码里有四份手写副本：`Apps/Desktop/Main.ts` 的 handler 与 `webContents.send`、`Apps/Desktop/Preload.ts` 暴露的方法、`Frontend/src/app/desktopBridge.ts` 的 `SeneraDesktopBridge`、以及桌面 E2E 的假 main（`Scripts/BrowserE2ETests/DesktopJourney/electronDesktopHarness.cjs`）。`SeneraDesktopBridge` 的方法全是 optional，`ipcRenderer.invoke` 返回 `any`，所以 TypeScript 无法发现只在单侧存在的 channel。

`Scripts/VerifyDesktopIpcContract.ts`（platform suite）用 AST 比较这四份面并断言：

- main `handle` 的 channel 集合 == preload `invoke` 的 channel 集合；
- main `webContents.send` 的 channel 集合 == preload `on`/`removeListener` 的 channel 集合；
- 假 main `handle` 的 channel 集合 == 真实 main `handle` 的 channel 集合；
- preload 暴露的成员集合 == `SeneraDesktopBridge` 声明的成员集合；
- 任何非字符串字面量的 channel 直接失败。

新增或改名 channel 时四处必须同步；`Preload.cjs` 由 `Build/CopyRuntimeAssets.ts` 从 `Preload.ts` 用 esbuild 生成，不再有只编译不运行的假源。

窗口的安全边界固定为 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，窗口 IPC 校验 sender，外链走 `resolveAgentExternalUrl` 策略。这里要守的是契约一致性，不是任意代码执行。

## 3. 打包与发布链

`npm run desktop.pack`（`Apps/Desktop/PackageDesktop.ts`）是唯一的打包入口，顺序固定：

```text
npm run build → 前端构建 → desktop.prepare-native → desktop.prepare-mcp-runtime
→ electron-builder（安装器）→ npm run desktop.smoke
```

`electron-builder` 同时留下 `Release/win-unpacked/`，所以冒烟启动的就是安装器要装的同一份文件。`.github/workflows/release.yml` 的 desktop job 只调用 `npm run desktop.pack`，冒烟失败即 job 失败，`upload-artifact` 与发布不会执行。

`npm run desktop.smoke`（`Apps/Desktop/SmokeDesktopPackage.ts`）启动打包产物并断言只在打包版才走全的路径：

- `Release/win-unpacked/Senera.exe` 存在（否则直接报错并提示先打包）；
- 用临时 `SENERA_WORKSPACE_ROOT` + `SENERA_DATA_ROOT` + 空闲 `SENERA_SERVER_PORT` 启动，模拟首次启动（无持久化工作区选择，否则会阻塞在目录选择框）；
- 主窗口标题为 `Senera`、`window.seneraDesktop.isDesktop` 为真、workspace 外壳 `[data-workspace-main]` 可见；
- 渲染进程真的连上了窗口 URL 里的 `webSocketUrl`；
- `desktop.log` 出现 `desktop ready in …`、没有 `startup failed`，工作区已从打包的示例配置播种 `senera.config.json`，且留下了会话标记；
- 通过 `openSettings({ section: "appearance" })` 打开设置窗，URL 的 `section` 未被归一化；
- `forcefullyCrashRenderer()` 后两个窗口都自动重载并恢复可用；
- `app.quit()` 后会话标记被清除。

它只覆盖 Windows 发布链；其他平台没有对应产物，脚本会明确报错。`package.json` 的 build target 只有 Windows NSIS，所以 Darwin 分支不算「已存在的发布缺陷」，除非真的产出 macOS 包。

开发模式的渲染路径要与打包版一致：`npm run desktop.live` 默认不再传 `--disable-gpu --disable-gpu-compositing --in-process-gpu`，需要诊断时才用 `SENERA_DESKTOP_DIAGNOSTIC_GPU=1 npm run desktop.live`。

原生模块走 N-API 预编译产物，不按 Electron ABI 重建：`Build/PrepareElectronNativeModules.ts` 按 Electron 版本/平台/架构 staging，`Build/ElectronAfterPack.cjs` 注入 `app.asar.unpacked`，`package.json` 固定 `npmRebuild: false`、`afterPack`、`asarUnpack`。staging 缺失时 `afterPack` 直接抛错，所以 `desktop.prepare-native` 不能从打包链里省掉。

## 4. 崩溃恢复

长驻托盘是默认行为，所以崩溃必须有恢复路径：

- **renderer**：`render-process-gone` 记录 `window`/`reason`/`exitCode` 后原地 `reload()`（设置窗的 URL 携带 `section`，重载后仍是同一分区）。60 秒内超过 3 次崩溃停止自动重载并记录 `renderer crash loop detected`，避免无限重载。`unresponsive` 只记录。
- **crashReporter**：启用且 `uploadToServer: false`，dump 落在 Electron 的 `crashDumps` 目录；启动时把该目录写进 `desktop.log`。
- **main**：安装 `installAgentProcessFailureGuard`，未捕获异常先记录到 `desktop.log`，再尽力停止 server 后退出。
- **下次启动**：会话达到就绪时写入 `<workspace>/.senera/desktop/desktop.session`，干净退出时删除。启动时若发现残留标记，就在 `desktop.log` 记录 `previous desktop session did not shut down cleanly`——main 没有 supervisor，这是崩溃唯一的持久痕迹。
- **utility process**：`child-process-gone` 记录 `type`/`reason`/`exitCode`/`service`；server 崩溃不会静默。

## 5. 启动成本预算

唯一口径是 `desktop.log` 的 `desktop ready in Xms server=Xms frontend=Xms`：`server=` 是窗口等 utility process 的时长，`frontend=` 是 `loadFile` 之后的加载时长。

打包版基线（2026-10-26，本机 Windows 10.0.26200 x64，Electron 42，`npm run desktop.smoke` 直接读打包产物）：冷缓存首次 `desktop ready in 3490ms server=2811ms frontend=276ms`，热缓存两次 `desktop ready in 2145ms server=1797ms frontend=87ms` 与 `desktop ready in 2164ms server=1822ms frontend=89ms`。同一口径下，单文件打包前是 `desktop ready in 5786ms server=5358ms frontend=172ms`，即 `server=` 从 5.4s 降到 1.8–2.8s。live 模式（Vite dev）的前端项不具可比性，不要用来定预算。

剩余约 2s 的构成与为什么不继续拆：

- pi 栈（`pi-coding-agent`/`pi-ai`/`pi-agent-core` + `typebox`）占打包前模块数的 54%，但 `new AgentPiSubstrate` 只在 `AgentSystemRuntimeCache.acquire()` 时执行（两个调用点都在 async 路径内），启动成本来自**静态 import 边**而非构造时机。
- 单文件 bundle 未开 `splitting`，动态 `import()` 只延后求值、不省解析，31.4MB 的解析成本仍在。
- 因此见效需要同时：拆 bundle 分块、拆 `PiWorkspaceSystemTools` 的同步工具目录契约（顶层用 pi 构造工具定义）、并把配置错误从「启动期同步抛」改成「首个 turn 抛」。最后一条是用户可见的语义变化，需要产品决策，所以当前**接受现状并把 `server≈2s` 记为预算上限**；懒加载的判据点与证据留在[后续改进清单](../Development/FollowUpBacklog.md)第 12 项。

## 6. 验证入口

| 检查                           | 位置                                     | suite    |
| ------------------------------ | ---------------------------------------- | -------- |
| IPC 四方契约一致               | `Scripts/VerifyDesktopIpcContract.ts`    | platform |
| bundle 存在/新鲜/锚点有效      | `Scripts/VerifyDesktopServerBundle.ts`   | platform |
| 启动画面调色板与品牌标记       | `Scripts/VerifyDesktopStartupSurface.ts` | platform |
| 资源根、工作区解析、路径分支   | `Scripts/VerifyDesktopRuntimePaths.ts`   | platform |
| 打包产物启动冒烟（含崩溃恢复） | `Apps/Desktop/SmokeDesktopPackage.ts`    | 发布链   |

## 7. 相关文档

- [工作区宿主](./WorkspaceHost.md)——安装资源与工作区的分离
- [部署与运维](../Operations.md)——安装包、更新与受控浏览器
- [浏览器端到端测试](../Development/BrowserE2ETesting.md)——桌面 E2E 的宿主与断言边界
