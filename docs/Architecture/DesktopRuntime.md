# 桌面运行时

## 启动与模块加载

Electron 主进程负责窗口、托盘、IPC 和更新；工作区服务运行在 `utilityProcess` 中。服务启动与窗口初始化并行，服务就绪前显示本地启动页，避免空白窗口。启动页不引用网络资源，支持系统深浅色与减少动效设置，并有直接加载真实 HTML 的 Ladle 预览。

`Build/BundleDesktopServer.ts` 将编译后的应用模块图收敛到 `Dist/Apps/Desktop/DesktopServerProcess.bundle.mjs`。所有第三方包使用 esbuild 的 `packages: external` 保留包边界，原生加载器、动态解析与工作线程仍从原包加载，无需维护原生包白名单。应用自身的 `import.meta.url/dirname/filename` 通过 AST 改写为相对原模块的锚点，同目录资产和子进程路径不随打包移动。

缓存记录实际依赖图，并对输入内容、打包器、锁文件和 TypeScript 配置计算摘要；输入修改或删除会触发重建。构建检查同时验证摘要和锚点目标。

## 窗口和通信

主窗口、设置窗口与 Senera QQ 独立窗口复用当前工作区服务。IPC 的生产实现分别位于 `Main.ts`、`Preload.ts` 和前端 `desktopBridge.ts`；修改时需同步现有桌面 E2E 宿主。

正式版主窗口和设置窗口从已就绪的本地服务 HTTP 同源入口加载，共用 WebSocket、认证和资源链路；仅启动页在服务就绪前读取本地文件。开发模式保留显式配置的 Vite 入口。来源校验不接受任意 `file://` 或 `null` 来源。

窗口保留 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。外链使用统一的外部 URL 策略，设置窗口保留现有就绪握手和未保存修改确认。

### 用默认应用打开资源（`senera:file.open-external`）

浏览器里预览不了的文件（docx、xlsx、压缩包等）只能靠系统默认应用打开，桌面端为此提供一条固定边界的通道：

- renderer 用自己已认证的会话 `fetch` 取回资源字节，再把 `{ name, bytes }` 交给 main（`Frontend/src/app/desktopBridge.ts` 的 `openFileWithDefaultApp`）；
- main 只做两件事：把字节写进 `%TEMP%\senera-opened-files\<安全文件名>`，然后 `shell.openPath`（`Apps/Desktop/DesktopExternalOpen.ts`，上限 64 MiB，`readDesktopExternalOpenRequest` 拒绝空载荷与非字节载荷）；
- 文件名按 `path.basename` 收敛、过滤控制字符与 `<>:"/\|?*`、限长 100 字符并保留扩展名、避开 Windows 保留设备名，因此资源名无法把文件写到临时目录之外；同名资源每次重写同一个文件，不累积副本。

main 不替 renderer 发网络请求、也不接收工作区路径，所以这条通道既不能变成请求伪造，也不暴露宿主文件系统。web 端没有该 bridge 时按钮不渲染，下载仍是唯一出口。

## 恢复与诊断

- 渲染进程意外退出后原地恢复，保留 URL 中的工作区和设置位置；正常退出不触发恢复。
- 每个窗口最多在 60 秒内自动恢复 3 次，超过限制停止重载并写入日志，避免持续刷新。窗口销毁时清理计数。
- 本地 crashReporter 不上传报告，启动日志记录转储目录。
- 主进程未捕获异常通过统一的进程保护器记录并尝试关闭工作区服务。
- 服务就绪后写入工作区的 `desktop.session`；成功停止服务后清除。下次启动发现残留时记录异常退出。
- 子进程退出、窗口无响应与恢复失败均保留日志。

`desktop.log` 的 `desktop ready in Xms server=Xms frontend=Xms` 用于比较实际启动时间。当前实现与上游打包策略不同，不能直接引用上游的耗时作为本地性能结果。

## 开发与打包验证

`desktop.live` 按源码与构建状态判断是否需要增量编译；诊断 GPU 开关通过 `SENERA_DESKTOP_DIAGNOSTIC_GPU` 显式开启。开发版有独立标记，正式版不展示。

`npm run desktop.pack` 编译源码和前端、准备原生模块与 MCP 运行时，再通过 `electron-builder` 生成安装包。发布流程检查安装包、差分更新文件与更新清单后上传产物。

| 检查                   | 入口                                                                             |
| ---------------------- | -------------------------------------------------------------------------------- |
| 模块锚点、缓存和产物   | `Scripts/VerifyDesktopServerBundle.ts`                                           |
| 启动页主题与品牌资产   | `Scripts/VerifyDesktopStartupSurface.ts`                                         |
| 原有路径与前端加载契约 | `Scripts/VerifyDesktopRuntimePaths.ts`、`Scripts/VerifyDesktopFrontendSource.ts` |

相关说明：[工作区宿主](./WorkspaceHost.md)、[部署与运维](../Operations.md)、[浏览器端到端测试](../Development/BrowserE2ETesting.md)。
