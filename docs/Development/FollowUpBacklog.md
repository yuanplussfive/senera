# 后续改进清单

这份文档记录一次架构复查的结论：九项候选问题、每项的核实结果、可选方案与执行顺序。它不是路线图，而是一份**带证据的待办**——每条结论都标了核实位置，可以直接照着看代码。

结论按可信度分三档：

- **已确证的缺陷**：机制明确、有可复现的判据，修复点单一。
- **需要产品决策**：代码按现状是对的，是否要改取决于产品取舍。
- **已降级**：复查后判定现状健康，不构成缺陷。

## 1. 图标治理（已收尾）

本轮已交付的图标工作，共 10 个文件、991 行新增、17 行删除：

| 文件                                                     | 说明                                            |
| -------------------------------------------------------- | ----------------------------------------------- |
| `Frontend/src/shared/ui/AppIcon.tsx`                     | 与冻结版对齐的图标映射；`activity` 保留当前实现 |
| `Frontend/src/shared/ui/AppIcon.stories.tsx`             | 新增 `ProductionSizes`，按真实尺寸铺开          |
| `Frontend/src/shared/ui/WindowControlGlyph.tsx`          | 窗口栏三个控件的专用几何                        |
| `Frontend/src/shared/ui/WindowControlGlyph.stories.tsx`  | 同上                                            |
| `Scripts/AuditAppIconStrokePhase.mjs`                    | 像素相位度量工具                                |
| `Scripts/FrontendTests/App/DesktopWindowChrome.test.mjs` | 窗口栏行为断言                                  |
| [FrontendIconPixelPhase.md](./FrontendIconPixelPhase.md) | 相位原理与可用做法                              |
| `docs/Development/README.md`                             | 索引                                            |
| `Frontend/src/shared/ui/index.ts`、`package.json`        | 导出与脚本入口                                  |

`activity` 保持当前 main 的 `SeneraActivityMark`，其余同名图标采用冻结版映射，当前 main 独有名称（`thinking`、`sparkles`、`wand`、`paperclip`、`puzzle`、`flag`、`map-pin`）全部保留。MCP、Skills、SettingsWorkbench、设置保存流程、供应商图标资源均未改动。

**一次证伪记录。** 曾考虑「限制允许的渲染尺寸」来规避相位差，实测否掉了：只有恒定画满 2.0 设备像素能做到全尺寸对齐，而按这个规则落地意味着改动 314 处 `<AppIcon>` 元素却对缺陷没有作用。详见 [FrontendIconPixelPhase.md](./FrontendIconPixelPhase.md) 第 6 节。有效的组合只有两件事：让缺陷在 Story 里按真实尺寸可见，加上可重跑的度量脚本。

## 2. 工作区边界：lexical 根与 canonical 目标的错配（已确证）

**判据点**：`Source/AgentSystem/Execution/SeneraWorkspaceBoundary.ts:208`

```ts
const classification = classifyAgentWorkspaceResource(this.workspaceRoot, canonicalTarget, scope);
```

`this.workspaceRoot` 在 `:63` 只做了 `path.resolve`（纯词法，保留短名、junction、`subst` 等别名），而 `canonicalTarget` 来自 `:169` 的 `realpath(anchor)`（真实路径）。容器判断在 `:172` 是 canonical 对 canonical，正确的；分类这一步却是 lexical 对 canonical。

`classifyAgentWorkspaceResource` 在目标不位于根之下时返回 `Unknown`（`Source/AgentSystem/Core/AgentWorkspaceLayout.ts:158-161`）。于是后果是：

- 工作区通过别名进入时，`.senera/` 下的资源从 `host-state` 退化为 `unknown`；
- `skills/`、`mcp/` 下的资源从 `managed-skill`、`managed-mcp` 退化为 `unknown`；
- OPA 策略里针对这些域的拦截因此**整体失效**（`Source/AgentSystem/Safety/AgentResourceAccessPolicy.rego:40`、`:48`、`:57`，域清单见 `AgentToolApprovalPolicy.data.json:46-47`）。

注意失效方向：最终放行分支要求 `containment == "inside"`（rego `:70-72`），而 containment 是 canonical 对 canonical 算出来的，所以**越界仍然被拦住**。错配丢掉的只是「受保护域 / 受管扩展域的变更护栏」。

**已排除的两个误判。**

其一，不是大小写问题。在 win32 上 `path.relative("C:\Workspace", "c:\workspace")` 返回 `""`，`isSamePath` 判为同一路径。真正的触发条件是文件系统级别的别名：junction、符号链接、`subst` 盘、8.3 短名。

其二，`realpath` 的两个实现行为不同，这是本条最关键的实测：

```
C:\PROGRA~1 →  fs.realpathSync         = C:\PROGRA~1        （不展开）
              fs.realpathSync.native  = C:\Program Files   （展开）
              fs.promises.realpath    = C:\Program Files   （展开）
```

边界用的是 `node:fs/promises` 的 `realpath`（`:222`），会展开；而 `workspaceRoot` 可能在别处由 `path.resolve` 产出，不展开。两者永远匹配不上。

**其余 realpath 调用点**（同一族，值得统一口径）：

| 位置                                                                   | 行为                              |
| ---------------------------------------------------------------------- | --------------------------------- |
| `Source/AgentSystem/WorkspaceResources/AgentWorkspaceCatalog.ts:25,42` | 展开（`.native`）                 |
| `Scripts/WorkspaceRoot.ts:27`                                          | 展开（`.native`）                 |
| `Source/AgentSystem/Execution/SeneraWorkspaceBoundary.ts:222`          | 展开                              |
| `Source/AgentSystem/WebSocket/AgentStaticFrontendHttpApi.ts:25,72`     | **不展开**（普通 `realpathSync`） |

好消息是主服务入口本身经过了规范化：`Apps/ServerRuntime.ts:236` 走的是 `catalog.register(requestedRoot).root`，而 `AgentWorkspaceCatalog.resolveDirectory` 用 `realpathSync.native`。所以残余暴露面在于那些直接把未规范化的根交给边界构造器的调用方，例如 `Source/AgentSystem/Execution/SeneraLocalExecutionEnv.ts:101`（只做 `path.resolve`）。仍有四个入口只做词法解析：`Apps/SeneraCli.ts:60`、`Apps/AdminAccess.ts:25`、`Apps/DevServer.ts:13`、`Apps/DockerServer.ts:74`。

**候选方案**：

- **A. 构造期规范化**：`:63` 改为异步 canonical 化。改动最大，且构造器是同步的，要把初始化拆成异步步骤。
- **B. 分类用 canonical 根（推荐）**：把 `canonicalRoot` 传进 `resourceFacts`，用它与 `canonicalTarget` 配对。**注意求值顺序**：`:144` 的提前返回发生在 `:148` 的 `resolveCanonicalRoot()` 之前，那里 `canonicalRoot` 还不存在，所以不能只是换一个实参——要么把那次调用改用 `candidate` 走一条明确的「外部路径」分支，要么把 canonical 化提前。
- **C. 在分类处就地规范化**：`classifyAgentWorkspaceResource` 内部对两个入参都做 `path.resolve`。治标，且把同一次 realpath 的开销摊到每次调用。
- **D. `noFollowFlag()` 失败要响（推荐，独立小修）**：`:287-289` 在 `constants.O_NOFOLLOW` 不是数字时返回 `0`，在 Windows 上静默退化成普通 `open`。应改为显式报错或记录一次可观测的降级，而不是无声地丢掉 `O_NOFOLLOW` 保护。

推荐 **B + D**。

## 3. 前端错误上报链断了（已确证）

`componentDidCatch` 在 `Frontend/src/shared/ui/ErrorBoundary.tsx:33-39`：

```ts
if (import.meta.env.DEV) {
  console.error("ErrorBoundary caught an error:", error, errorInfo);
}
this.props.onError?.(error, errorInfo);
```

生产构建里第一行整段消失，第二行又永远拿不到回调——**全仓没有任何一处挂载传了 `onError`**。已核实的五个挂载点：

`Frontend/src/App.tsx:522`、`App.tsx:586`、`Frontend/src/features/chat/ChatPanel.tsx:102`、`Frontend/src/features/terminal/TerminalPanelStatus.tsx:49`、`Frontend/src/main.tsx:69`。

净效果：线上崩溃只留在用户的界面里（`ErrorBoundary.tsx:87` 取的 `error.stack` 会渲染出来，可复制），没有任何一条离开浏览器。

**候选方案**：

- **3-1** 把 `onError` 补到五个挂载点。
- **3-2（推荐）** 去掉 `DEV` 闸门，改为模块级 `reportClientError(error, info)`，由它统一决定 `console` 与远端上报，`onError` 只作可选覆盖。挂载点不动也能生效。
- **3-3** 给上报加去重与限流（同一 `stack` 指纹、时间窗内只发一次），避免渲染循环把上报打爆。
- **3-4（推荐，独立小修）** `Source/AgentSystem/Resources/AgentResourceResolver.ts:82-84` 把 `policy_denied`、`link_not_allowed` 与真正的「文件不存在」一起吞成 `undefined`。语义上合理（坏链接就是坏链接），但**完全不可观测**：策略拦截和拼错路径在日志里长得一样。应在吞掉之前按 debug 记一条，至少能把两者区分开。

## 4. 显式激活契约（部分确证）

`AgentExplicitActivationSetSchema` 在 `Source/AgentSystem/Activation/AgentActivationTypes.ts:31` 把 `explicit` 上限设为 32 条，但 `normalizeAgentExplicitActivations`（`:59-81`）不做这个检查。两条路径两套规则，走 normalizer 的调用方可以突破上限。

其余核实到的点：

- `AgentLoop.ts:269` 在拿到 `explicitActivations` 却没有 `catalogRevision` 时抛的是裸 `Error`，会以通用失败的形式冒出来，不是带类型的契约错误。
- `AgentTurnPreparationSnapshot.ts:184-191` 把整份 catalog revision 纳入摘要比较，因此**新增任意一条激活条目都会让所有缓存的重放快照失效**。行为正确，但失效面比必要的大。
- `Source/AgentSystem/Skills/AgentSkillActivation.ts:156` 在规范化时用字面量 `"runtime"` 作为 revision 哨兵，与主循环使用的真实 catalog revision 不可比。这未必是缺陷，但两处口径不同值得确认。

**候选方案**：把上限检查下沉进 normalizer（与 schema 同源）；把裸 `Error` 换成 `AgentExplicitActivationError`；其余两条先记录，不动。

## 5. 前端设置导航（已确证，且是第 6 项的前提）

`Frontend/src/features/settings/SettingsWorkbench.tsx:82` 的换节逻辑只有一行 `onSectionChange(nextSection)`，没有滚动、没有焦点转移。搜索确实按字段建了条目（`settingsPresentation.ts:138-147`），但 `SettingsSearchEntry` 只带 `sectionId`（`:20-25`），所以**选中一个字段搜索结果只能落到分区，落不到字段**。

第 6 项（字段聚焦）之所以做不了，根因在这里：`Frontend/src/shared/config/JsonConfigForm.tsx:132` 只在容器上给了 `data-json-config-section`，字段行只按 `field.path.join("\u001f")` 做 React key（`:136`），**没有 `id`、没有 `data-field`、没有锚点**。没有可寻址的落点，导航就无法定位。

**方案**：先给字段行加 `data-field` 锚点与稳定的 `id`（由 `field.path` 派生），再让 `SettingsSearchEntry` 带上字段路径，最后在 `requestSectionChange` 之后补一次 `scrollIntoView` + `focus`。三步有严格顺序，不能跳。

## 6. 存储视图（前提不成立）

原先的判断是「存储视图缺少逐工作区数据」。核实后不成立：`Frontend/src/features/settings/sections/StorageSettings.tsx:51` 已渲染 `snapshot.root`，`:54` 渲染总量，`:56-61` 逐条渲染每个工作区的 `root` 与 `formatFileSize(workspace.bytes)`。契约侧也齐备（`AgentApplicationStorageSnapshotSchema` 的 `workspaces` 数组带 `id`、`name`、`root`、`bytes`）。

剩下的只是排序与聚合方式，属于产品取舍，不是缺陷。

## 7. 工作区设置入口（无缺陷）

与第 6 项同源，现有入口已经够用。是否需要独立入口是产品决策。

## 8. MCP 生命周期（已降级）

复查后判定现状健康：客户端池有租约与上限（`Source/AgentSystem/Mcp/AgentMcpToolClientPool.ts:45` 的 `MaxStaleClientReplacements = 1`，失败分支在 `:188-195` 完整清理条目），stdio 传输的 `close()` 靠 `closePromise` 做成幂等（`AgentMcpStdioTransport.ts:195-200`），重复关闭是安全的。

原先担心的「替换包时凭据泄漏」缺少前提：**全仓不存在 `replacePackage`**（已用精确 token 与同类命名多次检索确认）。凭据单独存在加密 SQLite 里，按 `(server_id, name)` 建键，没有外键也没有级联（`Source/AgentSystem/Credentials/Database/migrations/0001-mcp-credential-vault.sql`）。

因此真正的开放问题不是生命周期，而是**删包时凭据是否会成为孤儿**。这需要一次针对性的确认，不是泛化的「生命周期安全问题」。

## 9. Skills（已降级）

Skills 没有代码执行路径，失败时是 fail-closed。原先排在第 5 位的「Skills 安全问题」在复查中没有找到对应实体。保持现状。

## 10. 执行顺序

**第一档：立即做（缺陷明确、修复点单一、互不依赖）**

1. 第 2 项方案 B——`:208` 分类改用 canonical 根，同时处理 `:144` 的求值顺序。
2. 第 3 项 3-2——去掉 `DEV` 闸门，加模块级 `reportClientError`。
3. 第 2 项方案 D——`noFollowFlag()` 失败要响。
4. 第 3 项 3-4——策略拒绝与文件缺失在日志上区分开。

**第二档：结构性（有明确依赖顺序）**

5. 第 5 项的三步：字段锚点 → 搜索条目带字段路径 → 滚动与聚焦。
6. 第 4 项：上限检查下沉进 normalizer，裸 `Error` 换成类型化错误。

**第三档：需要产品决策，或需要先做一次针对性确认**

7. 第 7 项是否需要独立的工作区设置入口。
8. 第 6 项的聚合与排序方式。
9. MCP 删包时的凭据清理策略（先确认，再决定改不改）。

**可延后**：第 8、9 项（MCP 生命周期、Skills）在现有证据下不构成缺陷。

## 11. 三条前提更正

复查推翻了三个先前的判断，一并记录，避免后续再被引用：

1. **`isSamePath` 的大小写敏感性**——在 win32 上不成立。`path.relative` 会忽略大小写，判为同一路径。触发条件是文件系统别名，不是大小写。
2. **`replacePackage` 的存在性**——全仓不存在，任何依赖它存在的前提都不成立。
3. **存储视图缺少逐工作区数据**——不成立，`StorageSettings.tsx` 已经在渲染。

## 12. 相关文档

- [图标像素相位](./FrontendIconPixelPhase.md)——第 1 项的完整推导与度量方法
- [前端设置工作台约束](./FrontendSettingsWorkbench.md)——第 5 项的周边约束
- [核心链路导览](../Architecture/CoreFlow.md)——第 2、3 项涉及的执行与事件链路
- [工作区宿主](../Architecture/WorkspaceHost.md)——第 2 项涉及的根路径与宿主关系
