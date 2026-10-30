# 工作区模型待办：默认工作区、会话绑定与多根

> 状态：**未实现**，保留待办。
>
> 本文记录一次针对“去掉工作区选择后会发生什么”的二次核实，以及按现代 Agent 设计收敛出的分阶段方案。它不是当前行为的说明，当前行为以 `docs/Architecture/WorkspaceHost.md` 和代码为准。
>
> 生命周期：P1/P2 落地后更新“当前行为”与验收结果；P3 落地后把最终语义并入 `docs/Architecture/WorkspaceHost.md`，删除本文；如果 P3 长期不做，保留本文，因为其中仍有未决产品决策和未验证边界。

## 1. 二次确认结论（2026-10-29）

### 1.1 当前行为

| 场景                             | 当前结果                                                                | 证据                                                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Server 启动未传 `workspaceRoot`  | 使用 `process.cwd()`                                                    | `Apps/ServerRuntime.ts:216`                                                                                                  |
| WebSocket 请求未带 `workspaceId` | 使用进程启动时的 `defaultWorkspaceId`                                   | `Source/AgentSystem/WebSocket/AgentWebSocketTransport.ts:255-257`                                                            |
| HTTP 请求未带 `workspaceId`      | 使用 `defaultWorkspaceId`                                               | `Source/AgentSystem/WebSocket/AgentWebSocketTransport.ts:492`                                                                |
| 显式 `workspaceId` 已失效        | 返回 `4404 / workspace_not_found`，**不回退默认**                       | `Source/AgentSystem/WebSocket/AgentWebSocketTransport.ts:258-264`、`docs/Architecture/WorkspaceHost.md:25`                   |
| Desktop 开发态无持久化选择       | 回退到仓库 `resourceRoot`                                               | `Apps/Desktop/DesktopRuntimePathResolver.ts:58-69`、`Apps/Desktop/DesktopRuntime.ts:71`                                      |
| Desktop 打包态无持久化选择       | 弹目录选择框；取消 → `DesktopWorkspaceSelectionRequiredError`，启动失败 | `Apps/Desktop/DesktopRuntime.ts:67-75`                                                                                       |
| Desktop 打包态持久化路径已失效   | 同上，重新弹框                                                          | `Apps/Desktop/DesktopRuntime.ts:67-75`                                                                                       |
| Desktop 切换工作区后             | 立即写入 `workspace.json`                                               | `Apps/Desktop/Main.ts:160-162`、`Apps/Desktop/DesktopRuntime.ts:119-123`                                                     |
| Server 重启后                    | 默认回到本次启动根目录，不是上次 UI 选择                                | `Apps/ServerRuntime.ts:216,270`；`AgentWorkspaceCatalog.recordOpened` 只排序，不改默认                                       |
| 多工作区运行时                   | 已支持并存；按 `workspaceId` 路由                                       | `Apps/ServerRuntime.ts:299-310`、`Scripts/BackendTests/WebSocket/WorkspaceTransportIsolationBehavior.test.ts`                |
| 会话与运行数据归属               | 每个工作区自己的 `.senera`                                              | `Source/AgentSystem/Core/AgentApplicationPaths.ts:35-48`、`Scripts/BackendTests/Runtime/ServerWorkspaceHostBehavior.test.ts` |

### 1.2 本次实际跑过的确认

```bash
npx --no-install tsx Scripts/VerifyDesktopRuntimePaths.ts
npx --no-install vitest run --config vitest.backend.config.ts Scripts/BackendTests/WebSocket/WorkspaceTransportIsolationBehavior.test.ts
npx --no-install vitest run --config vitest.config.ts Scripts/FrontendTests/Feature/WorkspaceSwitching.test.mjs
```

结果：三组均通过。确认了：

- 打包态无选择时 `resolveDesktopWorkspaceRoot` 返回 `undefined`（`Scripts/VerifyDesktopRuntimePaths.ts:16`）。
- 一个 transport 可以隔离多个工作区，未知 scope 永久关闭。
- 前端切换工作区依赖请求/事件关联，不从目录字符串或重连推断成功。

### 1.3 三个需要修正的直觉

1. **Server 的“默认工作区”不是全局设置，而是入口决定的。**
   - `Apps/Server.ts`、`Apps/DevServer.ts` 用 `process.cwd()`。
   - `Apps/DockerServer.ts` 用 `SENERA_WORKSPACE_ROOT` 或 `/data`。
   - `Apps/Desktop/DesktopServerProcess.ts` 用 desktop 已解析的 `workspaceRoot`。
   - `startSeneraServer` 本身只做 `options.workspaceRoot ?? process.cwd()`，不读环境变量。
2. **`defaultWorkspaceId` 是“本次进程的锚点”，不是“用户默认值”，也不是“上次使用”。**
   - 它由 `catalog.register(workspaceRoot)` 产生，并在 transport 生命周期内固定（`Apps/ServerRuntime.ts:270`）。
   - `catalog.recordOpened` 只把最近项移到列表前面（`AgentWorkspaceCatalog.ts:68-80`）。
3. **Desktop 的 `workspace.json` 是“上次选择”，不是“默认值”。**
   - 文件位于应用数据根的 `workspace.json`（`Apps/Desktop/DesktopRuntime.ts:58`）。
   - 解析优先级是：`SENERA_WORKSPACE_ROOT` > `workspace.json` > 开发态 `resourceRoot` > 打包态弹框。

## 2. 目标态（优化后）

| 场景                                         | 目标行为                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Desktop 首次启动、无 `workspace.json`        | 自动创建并使用默认工作区，**不弹阻塞框**                                                    |
| Desktop 持久化路径失效                       | 记录日志，回退默认工作区；不启动失败                                                        |
| Desktop `SENERA_WORKSPACE_ROOT` 指向无效目录 | 仍然硬失败；显式配置必须报错，不静默覆盖                                                    |
| Server 未传 `workspaceRoot`                  | 仍使用 `cwd`；语义写清楚，不假装是“用户默认”                                                |
| Server 重启                                  | 未显式指定时仍回到启动根目录；如产品需要“上次使用”，用独立字段，不复用 `defaultWorkspaceId` |
| Web 刷新且无 `workspaceId`                   | 落到 `defaultWorkspaceId`                                                                   |
| Web 显式 `workspaceId` 失效                  | 仍返回 `4404`，**绝不静默回退**                                                             |
| 新建会话                                     | 绑定一个工作区/项目；会话创建后不热切换（P3）                                               |
| 多个工作区                                   | 可同时存在运行时；切换不再等于全局替换（P3）                                                |
| 跨仓库任务                                   | 通过显式多根工作区表达，不靠反复临时加目录（P4）                                            |

## 3. 需要先做的产品决策

### D1. 默认工作区放在哪

候选：

- `~/Senera`（推荐）：可见、不和安装目录混在一起、通常不在 OneDrive 同步目录内。
- `Documents/Senera`：更易发现，但可能被 OneDrive 同步，不适合放数据库和 `node_modules`。
- 应用数据根下的子目录：最隐蔽，用户难以在文件管理器里找到项目文件；不推荐作为“项目型”默认。

约束：

- 不要把用户 home 根目录直接作为默认工作区；agent 的写入边界会覆盖整个用户目录。
- 默认目录必须可创建、可写、可删除；创建失败时要回退到目录选择器，而不是静默使用只读位置。

### D2. Server 是否需要“稳定默认”

当前 server 默认 = 启动根目录。若产品希望“服务器重启后回到上次工作区”，需要新增独立持久化字段，例如：

- `workspaces.json` 增加 **可选** `lastOpenedWorkspaceId`；旧文件仍可读。
- 不要复用 `defaultWorkspaceId` 的语义，也不要让 `recordOpened` 隐式改变启动默认。

注意：`AgentWorkspaceCatalogSchema` 当前是 `strictObject({ workspaces })`（`AgentWorkspaceCatalogContract.ts:14-16`），新增字段必须可选并兼容旧文件。`AgentWorkspaceCatalog` 构造时直接 `parse`，旧格式没有该字段也必须通过。

### D3. 会话绑定工作区的粒度

- 推荐：一个会话创建时绑定一个工作区；会话生命周期内不可更换。
- 换工作区 = 新建会话或显式“复制会话到另一个工作区”，不做隐式迁移。
- 侧栏按工作区/项目分组；不再让“当前工作区”成为全局单例。

### D4. 多根工作区的权限模型

- 每个根必须有独立的读/写模式，还是整个工作区统一模式？
- 是否允许根之间存在嵌套？嵌套会让路径归属和去重变复杂。
- 沙箱挂载是否需要把多个根映射到同一个 guest root？

在这三个问题确定前，不进入 P4。

## 4. 分阶段 TODO

### P1. Desktop 默认工作区（必须）

**目标**：打包态首次启动不再依赖阻塞式目录选择；`workspace.json` 只作为最近选择。

改动点：

- [ ] 在 `Apps/Desktop/DesktopRuntimePathResolver.ts` 增加纯函数，例如 `resolveDesktopDefaultWorkspaceRoot({ homeRoot, documentsRoot })`，不直接依赖 Electron，便于 `VerifyDesktopRuntimePaths` 覆盖。
- [ ] 在 `Apps/Desktop/DesktopRuntime.ts` 的 `prepareDesktopRuntime` 中增加默认分支：
  - `configuredWorkspaceRoot` 无效 → 保持硬失败。
  - `persistedWorkspaceRoot` 无效或缺失 → 解析默认路径，`fs.mkdirSync(..., { recursive: true })`，然后继续。
  - 默认路径创建失败 → 回退 `chooseDesktopWorkspace()`；取消时才抛错。
- [ ] 保留 `chooseDesktopWorkspace()` 供托盘和 `senera:workspace.choose-folder` 使用。
- [ ] `DesktopWorkspaceSelectionRequiredError` 在默认分支落地后删除，或降级为“默认目录也创建失败且用户取消”的唯一错误；不要保留两个语义重叠的错误。
- [ ] 默认目录创建成功后写入 `workspace.json`，让下次启动稳定命中。
- [ ] 更新 `Scripts/VerifyDesktopRuntimePaths.ts:16`：打包态无选择不再断言 `undefined`；新增默认路径、失效持久化路径、显式配置优先三组断言。
- [ ] 更新 `docs/Architecture/DesktopRuntime.md` 的首次启动说明和 `docs/Architecture/WorkspaceHost.md:46`。

验收：

- [ ] 打包态删除 `workspace.json` 后冷启动，直接进入主界面，默认目录被创建且包含 `.senera`。
- [ ] `workspace.json` 指向已删除目录时，冷启动回退默认目录，日志有记录。
- [ ] `SENERA_WORKSPACE_ROOT` 指向无效目录时仍然启动失败，错误信息明确。
- [ ] 托盘“选择工作区”仍能切换，并更新 `workspace.json`。
- [ ] 默认目录不可写时，出现目录选择器；取消后给出可操作的错误，不静默启动到只读目录。

风险：

- `app.getPath("documents")` 在 `whenReady` 之前不可靠；默认解析应放在 ready 之后，或只用 `os.homedir()`。
- Windows 路径长度、OneDrive 重定向、企业策略可能让默认目录不可写；必须保留选择器回退。
- `prepareDesktopRuntime` 目前直接调用 Electron `dialog`，单元测试困难；P1 需要注入 `chooseWorkspace` 或把“解析 + 创建”拆成可测函数。

### P2. Server 默认语义（应该）

**目标**：让“默认”可解释，不引入隐式状态。

改动点：

- [ ] 在 `Apps/ServerRuntime.ts` 提取 `resolveSeneraRequestedWorkspaceRoot(options)` 纯函数，明确优先级：`options.workspaceRoot` >（可选）持久化默认 > `cwd`。
- [ ] 保持入口现状：`Server.ts` / `DevServer.ts` 用 `cwd`；`DockerServer.ts` 用 `SENERA_WORKSPACE_ROOT` 或 `/data`；Desktop 用已解析路径。
- [ ] 如果产品决定要“重启恢复上次工作区”，给 `workspaces.json` 增加可选 `lastOpenedWorkspaceId`，并只在 `startSeneraServer` 未显式传 `workspaceRoot` 时使用。
- [ ] 不改变 `defaultWorkspaceId` 的不可遗忘语义；`forgetWorkspace` 仍拒绝删除默认工作区（`Apps/ServerWorkspaceHost.ts:155-165`）。
- [ ] 更新 `docs/Architecture/WorkspaceHost.md`，写清“默认工作区 = 本次启动锚点”与“上次打开 ≠ 默认”。

验收：

- [ ] 未传 `workspaceRoot` 时仍落到 `cwd`。
- [ ] 显式传入的 `workspaceRoot` 永远优先于持久化默认。
- [ ] 旧版 `workspaces.json` 无新字段时可正常读取。
- [ ] 显式失效 `workspaceId` 仍返回 `4404`，不因新增默认逻辑而回退。

风险：

- 把“上次打开”做成默认会让多客户端/多部署行为不可预测；默认应保持部署级稳定。
- 修改 catalog 文件格式会触碰共享密钥、迁移和多工作区存储测试；优先只加可选字段。

### P3. 会话/项目绑定工作区（推荐目标）

**目标**：从“全局当前工作区”迁移到“会话绑定项目”，支持并行。

服务端改动点：

- [ ] 明确会话归属：会话记录必须携带 `workspaceId`；当前会话数据已按工作区 `.senera` 分库，保持这一点。
- [ ] 新增或复用查询能力，让一个客户端可以列出多个工作区的会话摘要；不要跨工作区读取消息正文。
- [ ] 保持运行时按需打开：`host.open(root)` 已支持惰性打开和并发（`Apps/ServerWorkspaceHost.ts:190-236`）。
- [ ] 调整 `retireWhenIdle` 语义：会话所属工作区的运行时不能因为另一个工作区切换而被回收。

前端改动点：

- [ ] 新会话时选择 recent workspace / 打开文件夹 / 默认 Home；选择结果写入会话。
- [ ] `useWorkspaceController` 从“全局 snapshot + switch”改为“每个打开的工作区一个连接/快照”。
- [ ] `activateWorkspaceSessionProjection`（`Frontend/src/store/workspaceSessionProjection.ts:40-50`）目前会丢弃非当前工作区状态；P3 需要缓存每个工作区的投影，而不是切换时重置。
- [ ] URL 继续携带 `workspaceId`；深链接、刷新、404 恢复保持现有语义。
- [ ] 工作区切换器从“切换当前”改为“打开/关闭项目”，关闭前处理未保存编辑和运行中会话。

验收：

- [ ] 同时打开 A、B 两个工作区，各自会话列表、模型选择、草稿、上传互不污染。
- [ ] 在 A 运行长任务时切到 B，A 的运行时不被回收；A 完成后仍能收到事件。
- [ ] 刷新带 B 的 URL，恢复 B；不带 `workspaceId` 时落到默认。
- [ ] B 被删除后刷新，出现 4404 恢复页，不静默落到 A。
- [ ] 关闭项目/工作区时，未保存编辑器内容和运行中会话有明确确认。

风险/依赖：

- 当前前端是单 WebSocket + 单 projection；P3 是产品级改动，不是纯后端开关。
- 现有 `WorkspaceTransportIsolationBehavior` 已证明一个 transport 可服务多个工作区，可作为服务端基础。
- 需要决定“关闭工作区”是否停止后台任务；当前 `retireWhenIdle` 依赖客户端计数，不能直接复用。

### P4. 多根工作区（以后）

**目标**：一个会话可以跨多个根目录工作，但权限边界明确。

前置条件：

- [ ] 修 `docs/Development/FollowUpBacklog.md` 第 2 项：`SeneraWorkspaceBoundary` 的 lexical root 与 canonical target 不一致。
- [ ] 定义根列表、顺序、读写模式、嵌套/重叠规则。
- [ ] 定义沙箱挂载模型：多个根如何映射到 guest root。
- [ ] 文件索引、搜索、观察器支持多根去重。

验收：

- [ ] 两个互不嵌套的仓库可以同时读写，路径归属正确。
- [ ] 只读根不能被写工具修改。
- [ ] 根被删除或替换为符号链接时，权限判定失败关闭，不降级为 `unknown`。

风险：这是权限模型改动，不是 UI 功能；不要在 P1/P2 中顺手引入。

### P5. 每会话隔离（可选，配套 P3）

- worktree / overlay / 一次性容器，按会话创建，完成后显式 apply。
- 非 git 工作区需要 overlay 或容器 fallback。
- 参考实现方向：Claude Code `--worktree`、Cursor worktrees、Devin snapshot；不要把它当作工作区选择的替代品。

## 5. 非目标

- 不把显式失效的 `workspaceId` 静默映射到默认工作区。
- 不把用户 home 根目录作为默认工作区。
- 不在 P1 中改变会话模型或前端工作区切换 UI。
- 不引入第二套“workspace”术语；如果新增“项目”，在文档中明确它与工作区（状态根）的关系。
- 不在 canonical 路径边界修复前做多根工作区。

## 6. 开放问题

1. 默认工作区用 `~/Senera` 还是 `Documents/Senera`？（倾向 `~/Senera`）
2. 首次启动是否需要非阻塞提示“已为你创建默认工作区”，还是完全静默？
3. Desktop 是否允许“默认工作区”被删除/忘记？当前 `defaultWorkspaceId` 不可遗忘，Home 是否同样保护？
4. Server 是否需要“上次打开”恢复？如果需要，字段叫 `lastOpenedWorkspaceId`，不要复用 `defaultWorkspaceId`。
5. P3 中一个客户端同时打开多个工作区时，是每个工作区一条 WebSocket，还是一条连接内多路复用？当前 transport 按 URL 参数分发，前者改动更小。
6. 关闭项目时，运行中的会话是继续后台执行、等待完成，还是要求用户确认后停止？

## 7. 验证命令

```bash
# 当前路径解析行为
npx --no-install tsx Scripts/VerifyDesktopRuntimePaths.ts

# 多工作区路由与隔离
npx --no-install vitest run --config vitest.backend.config.ts \
  Scripts/BackendTests/WebSocket/WorkspaceTransportIsolationBehavior.test.ts

# 前端切换、投影与草稿隔离
npx --no-install vitest run --config vitest.config.ts \
  Scripts/FrontendTests/Feature/WorkspaceSwitching.test.mjs

# 改动后的完整平台验证
npm run build
npm run verify.suite -- platform
```

Desktop 首次启动属于打包专属路径，单元测试之外必须跑一次真实冷启动：

```bash
# 删除 workspace.json 后启动打包产物，确认不弹框且创建默认目录
# 参考 Apps/Desktop/SmokeDesktopPackage.ts 与 docs/Architecture/DesktopRuntime.md
```

## 8. 相关文档

- [工作区宿主](../Architecture/WorkspaceHost.md)
- [桌面运行时](../Architecture/DesktopRuntime.md)
- [后续改进清单](./FollowUpBacklog.md)
- [开发手册索引](./README.md)
