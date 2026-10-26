# 桌面运行时审计：IPC、打包与启动成本

状态：全部已修复（2026-10-26 复核）；本文作为历史审计记录保留，删除与否由 PR 作者在合并后决定
范围：Electron 桌面端，Windows 发布链
性质：带证据的缺陷/风险清单，不是性能预算，也不是路线图。

关闭条件：P0/P1 全部有回归验证；长期约束（IPC 单源、打包冒烟、进程边界）迁入架构文档后删除本文。不要把它留成永久流水账。

## 复核结论（2026-10-26）

本文的全部待办项已在桌面运行时改动中关闭，长期约束已迁入[桌面运行时](../Architecture/DesktopRuntime.md)：

| 原缺口                         | 关闭方式                                                                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IPC 契约无自动检查（§1）       | `Scripts/VerifyDesktopIpcContract.ts`（platform suite）用 AST 比对 main / preload / 前端 bridge / E2E 假 main 四方 channel 与成员集合                                        |
| 打包产物没有启动冒烟（§2）     | `Apps/Desktop/SmokeDesktopPackage.ts`（`npm run desktop.smoke`）在 `desktop.pack` 内启动 `Release/win-unpacked` 产物，失败阻止发布                                           |
| renderer/main 崩溃无恢复（§4） | `render-process-gone` 原地重载（含 60s/3 次崩溃循环熔断）、`crashReporter`、main 的 `installAgentProcessFailureGuard`、`child-process-gone` 日志、会话标记区分崩溃与干净退出 |
| 启动耗时无口径（§3）           | `desktop.log` 的 `desktop ready in Xms server=Xms frontend=Xms`；预算口径与打包基线见架构文档第 5 节                                                                         |

因此下面各节的“已确证缺失/当前没有”都是 2026-10-21 的判据，保留用于追溯证据，不代表当前实现。本文是否删除由 PR 作者在合并后决定。

结论按证据等级标注：

- **已确证**：代码路径明确，且有运行时或静态判据。
- **实测快照**：单机、特定模式下的数字；可复现，但不代表打包版或所有机器。
- **未验证/不适用**：没有证据，或当前发布链不覆盖。

## 0. 结论摘要

| 项目                                     | 状态                 | 影响                                                   |
| ---------------------------------------- | -------------------- | ------------------------------------------------------ |
| IPC 契约漂移                             | 已修复（#150）       | `Preload.ts` 经 esbuild 生成唯一运行时 `Preload.cjs`   |
| 设置分区漂移                             | 已修复（#150）       | 分区白名单改为共享 `isAgentSettingsSectionId`          |
| 打包产物没有启动冒烟                     | 已修复（2026-10-26） | `desktop.pack` 内启动打包产物，失败阻止发布            |
| 启动/内存成本                            | 已修复（2026-10-26） | 打包基线 `server=` 1.8–2.8s；口径见架构文档第 5 节     |
| renderer/main 崩溃无恢复                 | 已修复（2026-10-26） | 原地重载 + `crashReporter` + main guard + 会话标记     |
| macOS 26 系统级卡顿、V8 `EXC_BREAKPOINT` | 未验证/不适用        | 当前只发布 Windows；未观测到该崩溃，也没有恢复机制兜底 |

## 1. IPC 契约漂移（已修复，#150 复核）

### 复核结论（2026-10-21）

#150 已把 preload 收敛到单一 TS 源，并统一了设置分区：

- `Build/CopyRuntimeAssets.ts:13-25` 用 esbuild 把 `Apps/Desktop/Preload.ts` 打成 `Dist/Apps/Desktop/Preload.cjs`。
- `Apps/Desktop/Main.ts:308`、`:361` 的 `preload` 指向构建产物，不再引用仓库内的手写 `.cjs`。
- `Apps/Desktop/Main.ts:248-250` 改用共享的 `isAgentSettingsSectionId`，旧的本地分区白名单已删除。
- `Apps/Desktop/Preload.ts:33-37` 与 `Apps/Desktop/Main.ts:278` 的 `senera:workspace.request-folder` 已对齐。

仍未完成：main 发送/处理的 channel、preload 暴露的方法、前端 bridge 声明三者之间没有自动契约检查，channel 漂移仍可能靠回归测试之外的方式发生。

### 历史判据（v1.18.0）

当时实际运行时只加载手写的 `Apps/Desktop/Preload.cjs`：

- `Apps/Desktop/Main.ts:331`、`Apps/Desktop/Main.ts:385` 的 `preload` 都指向 `Preload.cjs`。
- `Build/CopyRuntimeAssets.ts:12-17` 只复制 `Preload.cjs`。
- `Apps/Desktop/Preload.ts` 会被 `tsc` 编译成 `Preload.js`，但没有任何运行时引用。
- `tsconfig.json` 的 `include` 只有 `**/*.ts`，`.cjs` 不参与类型检查。

因此 `Preload.ts` 提供的类型安全是假象；真正运行的是未类型检查的 `.cjs`。

### 已发生的漂移

**1. 托盘“选择工作区”失效**

`Apps/Desktop/Preload.ts:34-37` 有 `onWorkspaceFolderRequested`，实际运行的 `Preload.cjs` 没有。

`Apps/Desktop/Main.ts:302` 仍会发送：

```ts
mainWindow?.webContents.send("senera:workspace.request-folder");
```

运行时用 CDP 读取 `Object.keys(window.seneraDesktop)`，确认没有 `onWorkspaceFolderRequested`。结果是托盘菜单“选择工作区”只显示窗口，不弹目录选择；应用内 WorkspaceMenu 的“选择本地文件夹”仍然可用，因为它走的是 `chooseWorkspaceFolder`。

**2. 设置分区被静默改写**

`Apps/Desktop/Main.ts:56-68` 维护了一份旧分区白名单；前端 `Frontend/src/features/settings/settingsSectionContract.ts:1-16` 已经新增/改名。

| 前端有、Main 不认（会被改成 `model-service`）                       | Main 有、前端已无  |
| ------------------------------------------------------------------- | ------------------ |
| `prompt`、`system-tools`、`dependencies`、`mcp-servers`、`channels` | `system`、`skills` |

`Apps/Desktop/Main.ts:271-272`：

```ts
function resolveSettingsSection(section: string | undefined): string {
  if (!settingsSectionIds.has(section ?? "")) return "model-service";
```

CDP 实测：从主窗口调用 `window.seneraDesktop.openSettings({ section: "prompt" })`，设置窗 URL 仍是 `...&section=model-service`。

可达入口：`Frontend/src/features/chat/ChatComposer.tsx:454`（Persona）、`:464`（Plugins）、`:472`/`:480`（Skills/Web search）分别使用 `prompt`、`mcp-servers`、`system-tools`。桌面端这些菜单项都会打开错误分区。

### 根因

- channel 名是字符串字面量，5 份手写契约：`Main.ts` handler、`Preload.ts`、`Preload.cjs`、`Frontend/src/app/desktopBridge.ts` 的 `SeneraDesktopBridge`、`Scripts/BrowserE2ETests/DesktopJourney/electronDesktopHarness.cjs` 的假 main。
- `SeneraDesktopBridge` 所有方法都是 optional（`Frontend/src/app/desktopBridge.ts:22-44`），TypeScript 不会要求 preload 实现任何方法。
- `ipcRenderer.invoke` 的返回值是 `any`，前端 interface 只是断言。
- 桌面 E2E 用 `Scripts/BrowserE2ETests/DesktopJourney/electronDesktopHarness.cjs:42-65` 另写一套 handler，不经过 `Main.ts`，所以 main/renderer 漂移不会被它发现。

安全边界本身没有大问题：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，窗口 IPC 有 sender 校验，外链走 `resolveAgentExternalUrl` 策略。这里的问题是契约一致性，不是任意代码执行。

### 验收

- [x] 实际加载的 preload 暴露 `onWorkspaceFolderRequested`；托盘“选择工作区”能触发目录选择并切换工作区。
- [x] 对每个设置分区调用 `openSettings({ section })`，设置窗 URL 的 `section` 保持该项，不再被归一化成 `model-service`。
- [ ] 增加契约检查：`Main.ts` 发送/处理的每个 channel、实际 preload 暴露的每个方法、前端 bridge 声明的方法三者一致；新增/删除 channel 时检查失败。
- [x] `Preload.cjs` 由单一 TS 源打包生成，不再保留只编译不运行的假源。

## 2. 打包产物没有启动冒烟（已确证，P1；2026-10-26 已修复）

> 本节是 2026-10-21 的判据。缺口现由 `Apps/Desktop/SmokeDesktopPackage.ts` 关闭，见开头复核结论。

原生模块这条经典坑目前控制得不错，不要重复造轮子：

- 自定义 staging 只覆盖 `better-sqlite3`；它使用 N-API 10，自带各平台 prebuild。其余原生依赖（`@parcel/watcher`、`koffi`、`@node-rs/jieba` 等）同样走 N-API/预编译产物，不需要按 Electron ABI 重建。
- `Build/PrepareElectronNativeModules.ts:17-24` 按 Electron 版本/平台/架构 staging，`Build/ElectronAfterPack.cjs` 注入 `app.asar.unpacked`，`package.json` 设置 `npmRebuild: false`、`afterPack`、`asarUnpack`。

真正的缺口是：**打包产物从未被启动过**。

- `Apps/Desktop/PackageDesktop.ts:12-18` 只执行构建、前端构建、native staging、MCP staging、`electron-builder`。
- `.github/workflows/release.yml:404-450` 的 Windows desktop job 只检查安装包、`.blockmap`、`latest.yml` 是否存在。
- `recovery-windows` 跑的是未打包的 Electron E2E；`electronDesktopHarness.cjs` 又使用假 main。

因此“开发正常、打包启动失败”仍然可能发布出去。`Apps/Desktop/DesktopFrontendSource.ts`（Vite URL vs `file://`）、`Apps/Desktop/DesktopRuntimePathResolver.ts`（`isPackaged` 分支）、首次启动工作区选择，都是只在打包版才走全的路径。

### 验收

在 release job 中增加：

1. `electron-builder --dir` 产出 `Release/win-unpacked/Senera.exe`。
2. 设置临时 `SENERA_WORKSPACE_ROOT`，用 Playwright `_electron.launch({ executablePath })` 或等价方式启动打包产物。
3. 断言主窗口标题、`window.seneraDesktop.isDesktop`、打开设置窗、WebSocket 已连接；失败则阻止发布。
4. 至少跑一次首次启动（无持久化工作区）路径，确认目录选择/工作区初始化没有打包专属错误。

## 3. 启动与内存成本（实测快照，P2）

### 测量条件

- Windows 10.0.26200 x64；Electron 42.11.10。
- `npm run desktop.live`，构建时间 2026-10-19 17:10，Vite dev server；启动参数含 `--disable-gpu --disable-gpu-compositing --in-process-gpu`（`Apps/Desktop/RunDesktopLive.ts:23`）。
- 打包版没有本地安装包，未测。

### 数据

启动时间线（本地时间 +08）：

```text
17:11:02  进程启动
17:11:09  desktop.log: starting desktop runtime
17:11:10  首个前端快照事件（channel.status.snapshot）
```

约 **8.4 秒**到首个前端快照。v1.18.0 的 `Apps/Desktop/Main.ts` 静态导入整个 `ServerRuntime`，在创建窗口之前就付出模块图加载和 server 初始化成本；#150 已改为通过 `DesktopServerHost` 托管 server，行号与模块边界不再适用，本节数字仅作历史快照。

同一构建产物在纯 Node 下导入 `Dist/Apps/ServerRuntime.js`：

- 热缓存：**8.2s / 448MB RSS**。
- 冷缓存/杀软扫描：**70.6s / 412MB RSS**。这是单次极端值，不应作为常规预算。

驻留约一天后的进程：

| 进程              | 工作集    | 私有提交  |
| ----------------- | --------- | --------- |
| main（含 server） | 319MB     | 759MB     |
| renderer          | 201MB     | 209MB     |
| network service   | 59MB      | 15MB      |
| **合计**          | **553MB** | **937MB** |

main 进程监听 `127.0.0.1:8788`，确认 server 在 main 内。`Dist` 下 1543 个 JS 文件，`node_modules/electron/dist` 357MB，dev `node_modules` 约 1.5GB。

### 边界

- 这些数字来自 live 模式：Vite、React 开发运行时、禁用 GPU、in-process GPU 都会影响结果；不能直接当作打包版的性能结论。
- 24 小时驻留的内存包含会话/数据库/缓存增长，不等于冷启动基线。
- 纯 Node 导入耗时不包含 Electron 自身的 Chromium 初始化；它只证明 server 模块图本身很重。
- 未做系统级卡顿测量；不能从这些数据推断“打开 Senera 会让整机卡顿”。

### 可做的优化

1. [x] 先加 `desktop ready in Xms` 日志（`loadDesktopFrontend` 完成后），不要在没有打包版数据前定预算。
2. [x] 把 `startSeneraServer` 改为动态导入，并在窗口/启动画面之后再执行；至少消除“窗口出现前先加载完整 server 图”的白屏。（改为 `DesktopServerHost` 托管的 utility process + `Frontend/public/startup.html` 启动画面）
3. [x] 更彻底的是把 server 放到 `utilityProcess` 或子进程：它本来就通过 loopback HTTP/WS 通信，隔离后能减少 main 的 CPU/GC 对窗口 IPC 的影响，并获得崩溃隔离。代价是端口、生命周期和日志要重新编排。
4. [x] 保持 `--disable-gpu` 仅用于开发诊断；不要把它当成桌面默认参数。（`SENERA_DESKTOP_DIAGNOSTIC_GPU=1` 才启用）

## 4. renderer/main 崩溃没有恢复（已确证缺失，P1；2026-10-26 已修复）

> 本节是 2026-10-21 的判据。缺口现由 `Apps/Desktop/Main.ts` 的 renderer 重载 / `crashReporter` / `installAgentProcessFailureGuard` 与会话标记关闭，见[桌面运行时](../Architecture/DesktopRuntime.md)第 4 节。

长驻是默认行为：`Apps/Desktop/Main.ts:341-345` 拦截窗口 `close` 并隐藏到托盘；`before-quit` 才停止 server。

当前没有：

- `render-process-gone` / `child-process-gone` 处理；
- `crashReporter`；
- 桌面 main 的 `installAgentProcessFailureGuard`（只有 `Apps/Server.ts`、`Apps/DevServer.ts`、`Apps/DockerServer.ts` 安装了）。

后果：renderer 崩溃后窗口不会自动重载；main 崩溃会直接带走进程和在途任务。具体 V8 `EXC_BREAKPOINT` 未在日志中观测到，但“长驻 + 无恢复”的暴露面是真实的。

### 验收

- renderer 崩溃（可用 `webContents.forcefullyCrashRenderer()` 模拟）后自动重载并记录日志。
- `crashReporter` 启用，至少落本地 dump。
- desktop main 安装进程失败 guard，崩溃前执行 server 清理；不要把“优雅退出”误当成“崩溃恢复”，main 自身崩溃需要 supervisor 或下次启动恢复策略。

## 5. 不纳入本次结论

- **macOS 26 系统级卡顿**：`package.json` 的 build target 只有 Windows NSIS，release 只在 `windows-latest` 构建；当前没有 macOS 发布产物。代码里的 Darwin 分支未被打包验证，不能算已存在的发布缺陷。
- **V8 `EXC_BREAKPOINT`**：未观测到；没有 crash dump 或日志证据。只记录“缺少恢复机制”这个可确证缺口。
- **系统级卡顿**：未做测量；不要用单机内存/CPU 数字推断整机行为。

## 6. 执行顺序

**P0：先修用户可见的契约漂移**

1. [x] 修 `onWorkspaceFolderRequested` 与实际 preload 的漂移；托盘“选择工作区”恢复。
2. [x] 统一设置分区契约，删除 `Main.ts` 的旧白名单或改为共享常量；修 `prompt`/`mcp-servers`/`system-tools` 的入口。
3. [x] 加 IPC 契约检查，覆盖 main、实际 preload、前端 bridge。（`Scripts/VerifyDesktopIpcContract.ts`，另覆盖 E2E 假 main）

**P1：补发布防线**

4. [x] 打包产物启动冒烟，接入 release job，失败阻止发布。（`Apps/Desktop/SmokeDesktopPackage.ts`，由 `desktop.pack` 调用）
5. [x] renderer 崩溃自动重载 + `crashReporter` + main 进程 guard。

**P2：启动与进程边界**

6. [x] 加启动耗时日志并测打包版。（打包基线见[桌面运行时](../Architecture/DesktopRuntime.md)第 5 节）
7. [x] 动态导入 server / 启动画面；评估 `utilityProcess` 隔离（#150 已引入 `DesktopServerHost`，需按新边界重测）。（已隔离为 utility process + 单文件 bundle，按新边界重测见[后续改进清单](./FollowUpBacklog.md)第 12 项）

## 7. 立即复现（人工）

需要先以 live 模式启动，并确认 `SENERA_DESKTOP_REMOTE_DEBUGGING_PORT`（默认 9333）：

```bash
curl -s http://127.0.0.1:9333/json/list
```

在返回的 page target 上执行：

```js
Object.keys(window.seneraDesktop); // 应包含 onWorkspaceFolderRequested
await window.seneraDesktop.openSettings({ section: "prompt" });
// 再查 /json/list，确认 settings URL 的 section 仍是 prompt
```

这些仍是手工判据。P0 修复后应落成仓库内的契约检查脚本，而不是长期依赖手工 CDP。（已落成：`Scripts/VerifyDesktopIpcContract.ts`，本节保留为手工复现步骤）

## 8. 相关文档

- [桌面运行时](../Architecture/DesktopRuntime.md)——当前的进程边界、IPC 契约、打包冒烟与启动成本口径
- [后续改进清单](./FollowUpBacklog.md)
- [工作区宿主](../Architecture/WorkspaceHost.md)
- [部署与运维](../Operations.md)
- [前端性能预算](./FrontendPerformanceBudgets.md)（只覆盖前端 bundle，不覆盖 Electron 运行时）
