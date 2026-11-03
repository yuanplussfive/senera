# 桌面智能体边界：无窗口执行、文档生成与文件交付

状态：决策稿（2026-10-27）。第 1、2 节是硬约束，第 3、4 节含待实现项；每节都标了当前状态与验收判据。

范围：agent 在**用户真实机器**上运行时能触碰的东西——进程窗口、Office/文档、GUI 自动化、生成文件的交付与预览。

性质：带证据的约束文档 + 执行顺序。它约束"实现方式"，不是路线图；结论都能按 `file:line` 复核。

关闭条件：第 1–4 节全部有验收判据并通过验证后，把长期约束并入[桌面运行时](../Architecture/DesktopRuntime.md)与[核心链路导览](../Architecture/CoreFlow.md)，删除本文。

## 0. 结论摘要

| #   | 决策                                                       | 当前状态                                                     | 验收判据                                                     |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| 1   | 运行时每一处进程启动都必须无窗口；用 CI 不变量替代人工审计 | 进程层已满足，缺自动化校验；`Apps/ServerWatch.ts:123` 漏项   | `Scripts/VerifyWindowsProcessLaunch.ts` 进 platform suite    |
| 2   | 文档生成直写 OOXML，禁止依赖宿主 Office / COM              | 未实现（当前没有写文档的工具）                               | 新增文档写入工具 + shell 工具的 `Avoid` 明示禁止 COM         |
| 3   | GUI 自动化不得在用户真实桌面上默认发生                     | 未实现（computer-use MCP 已在本工作区启用）                  | 该 MCP 默认关闭 + 开启时明确提示                             |
| 4   | 生成文件走"预览阶梯"，最后一级才是交给系统默认应用         | 第 4 级已实现（`senera:file.open-external`）；第 2、3 级缺失 | docx/xlsx 有应用内预览；文本摘要兜底；工作区文件打开真实路径 |

判断依据（一句话）：**成熟产品的"不闪窗、不拉起 Office、不驱动用户桌面"不是靠调用参数调出来的，而是靠架构边界切出来的**——agent 的命令跑在无窗口的受管进程里，文档在沙箱里用库直接生成，需要 GUI 的 agent 只在一次性 VM/容器桌面上操作。

## 1. 无窗口执行是硬约束

### 1.1 结论

- 任何在用户机器上启动的进程（含 MCP server、浏览器驱动、ripgrep、观察者 worker、终端 sidecar）都必须带 `windowsHide: true`；这是**每个 spawn 点的义务**，不是某个抽象层的默认值。
- 禁止 `shell: true`、`detached: true`、`Start-Process`、`Invoke-Item`、`cmd /c start`。它们会绕过 `CREATE_NO_WINDOW` 的继承链。
- 用户主动打开的交互式终端（ConPTY）是唯一例外，它服务"用户要看"的场景；agent 的后台命令不得走 PTY。

### 1.2 证据

2026-10-27 全仓审计：`Source/`、`Apps/`、`Packages/`、`McpServers/` 共 27 处 spawn 族调用，**全部**带 `windowsHide: true`（代表点：`Source/AgentSystem/Execution/SeneraNodeProcessBackend.ts:60`、`SeneraOwnedProcessSpawner.ts:136`、`SeneraWindowsProcessSupervisor.cjs:81`、`AgentMcpStdioTransport.ts:171`、`PiWorkspaceSystemTools.ts:370`、`AgentNativeBrowserDriver.ts:926`）。仅三处例外：

| `file:line`                                                  | 情况                                                 | 判定                                                                                          |
| ------------------------------------------------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `Packages/TerminalSidecar/bin/senera-terminal-sidecar.js:44` | node-pty 不提供 `windowsHide`；ConPTY 宿主由系统创建 | 可接受：sidecar 进程本身隐藏（`SeneraTerminalSpawner.ts:64-71`），ConPTY 宿主 headless        |
| `Apps/Desktop/DesktopServerHost.ts:47`                       | Electron `utilityProcess.fork` 无该选项              | 可接受：utility process 不分配控制台                                                          |
| `Apps/ServerWatch.ts:123`                                    | `{ cwd, env, stdio: "inherit" }`，无 `windowsHide`   | **待修**（仅 `npm run dev.server`，父进程已持有控制台，实际不闪窗，但与其余 26 处口径不一致） |

本机实测（Windows 10.0.26200，用 koffi 调 `EnumWindows` + `IsWindowVisible`，3ms 轮询）：

- `windowsHide: true` 的进程树：**0 个新可见窗口**；让该进程再去启动一个控制台程序（模拟 `npm`/`git` 这类子进程），仍为 0。
- 对照组 `notepad.exe`：检测到 3 个新可见窗口 → 探测器有效，不是"测不到"。
- 结论：`CREATE_NO_WINDOW` 对整棵子进程树生效，"命令执行闪窗"不可能来自这 27 处启动点。

### 1.3 行业对照

- 桌面 IDE 类产品（VS Code / Cursor / Cline / Roo）把 agent 命令放进**集成终端会话**：命令在已有 PTY 里跑，用户看不到任何操作系统级控制台窗口；后台任务用无窗口子进程。
- CLI 类产品（Claude Code / Codex CLI）用**常驻 shell 会话**而非"一条命令一个进程"，既减少 conhost 抖动，也保留 cwd/env/别名。
- 需要 GUI 的产品（Manus / Operator / Devin / OpenHands）一律操作**容器或 VM 内的虚拟桌面**，从不驱动用户真实桌面。[INFERENCE] 具体实现细节不公开，但"沙箱化桌面"是其公开架构前提。

### 1.4 落地做法

- 新增 `Scripts/VerifyWindowsProcessLaunch.ts`（AST 扫描，做法照抄 `Scripts/VerifyDesktopIpcContract.ts` 的思路）：扫描 `Source/`、`Apps/`、`Packages/` 下的 `spawn`/`spawnSync`/`exec`/`execFile`/`fork`/`execa`/`pty.spawn`/`utilityProcess.fork`，断言每处要么显式带 `windowsHide: true`，要么在显式白名单里并写明理由（当前白名单只有上面两处可接受项）。接入 platform suite。
- 修 `Apps/ServerWatch.ts:123`。
- 把"禁止 `shell: true`/`detached`/`Start-Process`"写进 `System/Extensions/execute/shell/tools/ShellCommandTool.tool.json` 的 `Avoid`，让模型与实现者看到同一条约束。

### 1.5 反模式

- 依赖某个封装层的默认值来隐藏窗口——默认值会变，spawn 点不会自己报警。
- 用"测试里看不到窗口"当验收——CI 无桌面会话，测不到；可测的是"是否传了 flag"。

## 2. 文档生成不依赖宿主 Office

### 2.1 结论

- 生成 Word/Excel/PPT 一律**直写 OOXML**（docx/xlsx/pptx 就是 zip + XML），或在沙箱里用库生成；**绝不**自动化用户机器上的 Office。
- 需要格式转换（如 docx→pdf）时，用 **LibreOffice headless**（`soffice --headless --convert-to`，每实例独立 `-env:UserInstallation`），并且作为可选能力：检测不到就降级，而不是回退到 COM。
- 给模型的是**结构化工具**（创建文档/表格），不是"你自己想办法写 PowerShell"。

### 2.2 证据

- 全仓不存在任何 Office 自动化：`Word.Application`、`New-Object -ComObject`、`winword`、`docx2pdf`、`pandoc`、`soffice`、`libreoffice`、`Start-Process`、`Invoke-Item`、`shell: true` 全部无命中（`Source/`、`Apps/`、`Packages/`、`Frontend/`、`McpServers/`、`System/`、`prompts/`、`baml_src/`、`docs/`）。
- Office 支持目前**只读**：`Source/AgentSystem/Documents/AgentDocumentOfficeExtractor.ts:66`（officeparser，纯 JS，不启动 Office）。
- 因此"写入 Word 文档会启动好多次 Word"只能来自模型自选的命令，或第 3 节的 GUI 自动化通道——sen 自身没有这条代码路径。
- 用户可见后果：一个 .docx 需求会退化成"每条命令拉一次 Word"，且在用户屏幕上闪。这是**能力缺口导致的实现选择**，不是模型"不听话"。

### 2.3 行业对照

- 微软官方立场（KB257757，_Considerations for server-side Automation of Office_）：无人值守/服务端自动化 Office 不受支持、不可靠——即使 `Visible = false` 也会残留进程、弹对话框、随机失败。成熟产品因此不走这条路。
- 托管式 agent 产品的"生成一个 docx/xlsx/pptx"是在**服务端沙箱里用库生成文件再交付**（Python 侧 `python-docx`/`openpyxl`/`python-pptx`，Node 侧 `docx`/`exceljs`/`pptxgenjs`）。[INFERENCE] 具体库属实现细节；"沙箱内程序化生成、不依赖宿主 Office"是公开架构。
- 通用 agent 设计原则：**让正确路径成为最省力的路径**。缺结构化工具时，模型必然去抓最近的锤子（COM / 转换器 CLI）。

### 2.4 落地做法（待确认依赖）

- 新增工具（`System/Extensions/` 下新建文档域工具，或并入现有 document 扩展）：
  - `DocumentCreate`：输入结构化块（标题/段落/列表/表格/图片引用），输出 `.docx`；
  - `SpreadsheetWrite`：输入二维数据/公式，输出 `.xlsx`；
  - 两者都直接写 OOXML，零 Office 依赖，产物落工作区并由现有 workspace patch 观测链路记录。
- 依赖候选：`docx`、`exceljs`（JS 生态主流）；若坚持复用 Python 栈则用 `python-docx`/`openpyxl`，但要接受宿主 Python 依赖。**新增依赖需先过 `Scripts/VerifyWorkspaceDependencyGovernance.js` 与 `npm run quality.security`。**
- 在 `ShellCommandTool` 的 `Avoid` 里明确写出：不要用 COM/Office 自动化或会拉起 Office 的命令生成/转换文档。
- 覆盖测试：生成的 .docx 能被 `DocumentExtract`（officeparser）读回同样文本——这条断言把"能写"和"能读"锁在一起，不依赖 Office。

### 2.5 反模式

- `New-Object -ComObject Word.Application`、`docx2pdf`、`Visible = false`。
- 用"机器上装了 Office 就调 Office、没装就报错"的分支——用户机器不可控。
- 把转换器 CLI 当默认路径：LibreOffice 只能当降级项，且要显式检测。

## 3. GUI 自动化不得默认发生在用户真实桌面

### 3.1 结论

- 能启动/操作用户 GUI 应用的能力（computer-use 类 MCP：`open_application`、`activate_app`、`run_script`）必须**默认关闭**，开启时明确告知"会在你的桌面上启动应用并模拟输入"。
- agent 的默认执行面是**无窗口进程 + 工作区文件**；GUI 操作是用户显式授予的例外。
- 长期方向：需要 GUI 的自动化放进一次性容器/VM 桌面（当前发布链没有这条，属于方向而非本轮范围）。

### 3.2 证据

- `McpServers/zavora-computer-use/manifest.json` 提供 `open_application`/`activate_app`/`run_script`/`click_element` 等真实桌面自动化能力，工具清单里含"打开应用/启动程序/运行应用"等中文别名。
- 本工作区会话历史里存在 `mcp__zavora_computer_use__open_application`、`activate_window`、`run_script` 等工具名（`.senera/data/sessions/sessions.sqlite`、`.senera/data/orchestration/orchestration.sqlite` 的工具清单字段）→ 该 MCP 在此工作区是**启用**状态。
- 该 MCP 自身的 spawn 已隐藏（`node_modules/@zavora-ai/computer-use-mcp/dist/session/spawn.js:110-115`、`operator-control.js:391`），所以它带来的不是"控制台闪窗"，而是**真实应用的可见窗口**——这正是"启动好多次 Word"最直接的来源之一。

### 3.3 行业对照

- 让 agent 操作用户真实桌面的产品，都把这一步做成**显式授权 + 可见状态**（屏幕上出现明确的"正在被控制"提示、可随时中断）；其余产品把它隔离在 VM/容器桌面内。
- 没有任何成熟产品默认允许后台 agent 静默驱动用户桌面。[INFERENCE]

### 3.4 落地做法

- computer-use MCP 的默认状态改为关闭；启用走设置页显式开关，开启文案写明会启动/操作桌面应用。
- 若产品上要保留默认启用，则至少：工具调用前经过审批（现有审批模式已具备），并在 UI 上留下"将启动应用 X"的可见提示。

## 4. 预览阶梯与"用默认应用打开"

### 4.1 结论

文件交付是**四级阶梯**，不是"能预览/不能预览"二元判断：

| 级别               | 做法                                                             | 现状                                                     |
| ------------------ | ---------------------------------------------------------------- | -------------------------------------------------------- |
| 1 原生渲染         | 图片、音视频、PDF、文本、代码 diff                               | 已有（`Frontend/src/lib/filePreview.ts`）                |
| 2 应用内转换预览   | docx→HTML、xlsx→表格、md→HTML；重格式走 LibreOffice headless→PDF | **缺**                                                   |
| 3 已有解析器出摘要 | `officeparser` 抽取文本当兜底预览，比"不能预览"高一个量级        | **缺**（`DocumentExtract` 已具备该能力，只差接到预览面） |
| 4 交给系统默认应用 | 桌面端 `shell.openPath`；web 端只能下载                          | 已实现（`senera:file.open-external`，见 4.2）            |

打开文件时**优先打开真实文件**（工作区内的文件，路径做 realpath 包含性校验），临时副本只用于"本来就不在磁盘上"的资源（上传附件、artifact）。原因：临时副本的语义是"用户改完存不回去"。

### 4.2 已实现部分（2026-10-27）

- `Apps/Desktop/DesktopExternalOpen.ts`：载荷校验（≤64 MiB、非空字节）、文件名收敛（basename、过滤控制字符与 `<>:"/\|?*`、限长保留扩展名、避开 `CON/NUL/COM1` 等保留名）、写入 `%TEMP%\senera-opened-files\` 后 `shell.openPath`。
- `Apps/Desktop/Main.ts:323` 注册 `senera:file.open-external`（校验 sender）→ `Apps/Desktop/Preload.ts:32` → `Frontend/src/app/desktopBridge.ts` 的 `openFileWithDefaultApp`：**renderer 用已认证会话取字节**，main 不发网络请求、不接收工作区路径。
- UI：`Frontend/src/shared/media/OpenWithDefaultAppButton.tsx`（无 bridge 时完全不渲染，web 端行为不变），接入聊天附件预览的二进制面板、工作区工作台的二进制/超限面板、工具资源卡片中的非可预览类型。
- 验证：3 个测试文件 22 例通过；全量前端行为套件 141 文件 / 985 例通过；`VerifyDesktopIpcContract` 通过；真实文件系统冒烟（`..\..\windows\季度报告.docx` → `<temp>\季度报告.docx`，`nul.txt` → `_nul.txt`，300 字符主干截断且保留扩展名）。

### 4.3 待实现部分

- 第 2 级：docx→HTML（`mammoth` 或 `docx-preview`）、xlsx→表格（SheetJS）在前端/服务端渲染；PDF 已有 iframe 通道。**新增依赖同样要过依赖治理与安全审计**（SheetJS 的发行渠道与许可证需单独确认）。
- 第 3 级：把 `DocumentExtract` 的抽取结果接到预览面板，作为"无法渲染"时的文本兜底。
- 打开通道补一条**工作区路径优先**的分支（真实文件 + realpath 包含性校验）；保留现有字节通道给非工作区资源。暂存目录加清理策略（按名字重写已有界，另加 TTL 或启动清理）。

## 5. 执行顺序

依赖关系是硬的：先有"无窗口"不变量，才有资格谈后面的进程与 GUI；先有文档写入，模型才不会去抓 COM。

**P0 — 立即可做（无产品决策，互不依赖）**

1. `Scripts/VerifyWindowsProcessLaunch.ts` + 接入 platform suite（第 1.4 节）。验收：故意去掉任一 spawn 点的 `windowsHide` 会让该检查失败。
2. `Apps/ServerWatch.ts:123` 补 `windowsHide: true`。验收：检查脚本对全仓零豁免（除白名单两条）。
3. `ShellCommandTool.tool.json` 的 `Avoid` 增加禁止 `shell: true`/`detached`/`Start-Process`/COM 自动化的条目。验收：`npm run verify.system-extension-contracts` 通过（工具契约由生成器校验）。

**P1 — 结构性（需要一次依赖决策）**

4. 文档写入工具（`DocumentCreate`/`SpreadsheetWrite`，OOXML 直写）。验收：生成的 .docx 经 `DocumentExtract` 读回同样文本；测试不依赖 Office。
5. computer-use MCP 默认关闭 + 授权提示（第 3.4 节）。验收：默认配置下工具清单不含 `mcp__zavora_computer_use__*`；开启开关存在且有提示文案。

**P2 — 体验补齐**

6. 预览第 2 级：docx→HTML、xlsx→表格。
7. 预览第 3 级：抽取文本兜底。
8. 打开通道"工作区路径优先"分支 + 暂存目录清理。

**P3 — 方向**

9. 会话级常驻 shell 替代"一条命令一个进程"（减少 conhost churn，保留 cwd/env）。
10. GUI 自动化隔离到一次性容器/VM 桌面。

## 6. 明确不做的事

- 不用 COM/`docx2pdf`/`Visible=false` 自动化 Office（官方不支持，且必然在用户屏幕留窗口）。
- 不用 `shell: true`、`detached: true`、`Start-Process`、`cmd /c start`。
- 不让后台 agent 静默驱动用户真实桌面。
- 不用临时副本冒充"打开工作区文件"（除非资源不在磁盘上）。
- 不把"预览不了"当终态：先摘要、再系统应用，最后才是下载。

## 7. 证据索引

- 进程启动审计：27 处 spawn 族调用逐点列出 `file:line` 与选项对象；三处例外见第 1.2 节。
- 窗口实测：koffi → `user32.EnumWindows` / `IsWindowVisible` / `GetClassNameW`，3ms 轮询；`windowsHide` 树 0 个新窗口（含孙进程），`notepad.exe` 对照组 3 个。
- Office 自动化缺席：全仓 token 扫描（见第 2.2 节列出的词表）。
- computer-use MCP 启用证据：`.senera/data/sessions/sessions.sqlite`、`.senera/data/orchestration/orchestration.sqlite` 的工具清单字段。
- 文件交付实现：`Apps/Desktop/DesktopExternalOpen.ts`、`Apps/Desktop/Main.ts:323`、`Frontend/src/shared/media/OpenWithDefaultAppButton.tsx`。

## 8. 相关文档

- [桌面运行时](../Architecture/DesktopRuntime.md)——进程边界、IPC 契约（含 `senera:file.open-external` 的安全边界）
- [核心链路导览](../Architecture/CoreFlow.md)——工具执行与事件链路
- [工具执行运行时](../Architecture/ToolExecutionRuntime.md)——`ShellCommandTool`/`TerminalStartTool` 的落点
- [后续改进清单](./FollowUpBacklog.md)——架构复查的带证据待办（本文是另一条正交边界，不与之重叠）
- [桌面运行时审计](./DesktopRuntimeAudit.md)——历史审计记录
