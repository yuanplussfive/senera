# 前端 Agent 工作区全面重构方案

状态：方案 B 已选定；第一阶段主 Agent 工作区纵向切片已完成实现与验证

日期：2026-07-15

适用范围：`Frontend/`

## 1. 背景

Senera 当前已经具备会话、流式消息、模型与供应商配置、Preset、插件、审批、Workflow、响应式面板与主题系统。现有主界面也已经通过 Flex 布局实现了左右面板变化时中央区域自动伸缩，但消息、用户消息和输入区分别使用固定最大宽度，主工作区的空间变化没有完整传递到内容排版。

本轮目标不是重写业务系统，也不是以另一套 UI 框架替换现有前端。目标是在保持现有 API、事件、Session、Preset、Plugin、Workflow 与 Runtime 行为不变的前提下，全面优化前端 Surface 编排、交互、响应式、内容排版和视觉系统，使产品成为现代、克制、内容优先且具有明确 Agent 工作台特征的应用。

反 slop 基线见 [`../frontend-kill-slop-audit.md`](../frontend-kill-slop-audit.md)。扫描结果只能作为线索；品牌字标、功能性渐隐、真实链接下划线、进度动画、头像、开关、代码字体等有明确语义的表达不得被机械清除。

## 2. 已确认的设计目标

1. 主界面应当让用户一眼感知这是一个能规划、执行工具、管理上下文和产出 Artifact 的 Agent 工作台，而不是普通聊天软件。
2. 中央主画布随左右 Surface 开合自动伸缩，不能保留无意义的固定空槽。
3. 普通正文保持可读行长，代码、表格、Diff、Workflow 与 Artifact 可以使用更宽区域。
4. 左侧采用单一整合侧栏，不使用全局图标栏与会话栏两列嵌套导航。
5. 右侧采用默认收起的工具坞与按需上下文面板，不再永久占据固定 Workflow 第三栏。
6. Desktop、Tablet 与 Mobile 共享业务组件，只改变 Surface 编排。
7. 主题以受控语义 token 为基础；任意 CSS 仅作为未来高级能力。
8. 暖纸主题保留为可选预设，不再作为不可改变的默认视觉基础。
9. 本轮先完成主 Agent 工作区纵向切片，再向 SettingsWorkbench 和其他区域扩展。
10. 先审查方案与两套交互原型，批准后才修改生产前端。

## 3. 范围红线

### 3.1 本轮包含

- 主工作区布局与 Surface 编排。
- 左侧整合侧栏。
- 中央流体布局与 `ConversationFrame`。
- 右侧工具坞与现有 Workflow 的按需面板呈现。
- 消息、代码、表格与附件的自适应排版。
- Composer 的上下文条、输入区与稳定工具栏。
- Desktop、Compact Desktop、Tablet、Mobile 适配。
- 当前纵向切片需要的共享 UI primitives。
- 主题语义 token 与未来用户主题的前端边界。
- 键盘、触摸、焦点、Reduced Motion 与真实窗口验证。

### 3.2 本轮不包含

- 后端 API 或 WebSocket Protocol 修改。
- Runtime、Session 或审批业务语义修改。
- 新的统一任务状态机。
- Project/Workspace 后端模型。
- 完整 Agent Definition 领域模型。
- Preset 迁移或改名为 Agent。
- Plugin、Tool、Skill、Workflow 的领域关系重构。
- 为尚不存在的后端功能添加空导航入口。
- 新的大型 UI 组件库或全量 shadcn 化。

延期的 Agent Definition 领域工作见 [`../Architecture/AgentDefinitionRoadmap.md`](../Architecture/AgentDefinitionRoadmap.md)。

## 4. 当前实现基线

### 4.1 Shell 已具备流体伸缩基础

`Frontend/src/layout/AppShell.tsx` 当前采用横向 Flex：

- 左侧 `motion.div` 在 rail 与 panel 宽度之间动画。
- 中央容器为 `flex min-w-0 flex-1`。
- 右侧 `motion.div` 在 rail 与 Workflow panel 宽度之间动画。
- 外层为 `overflow-hidden`。

因此，本轮不应重写中央宽度计算。浏览器 Flex 布局已经会把左右面板之外的空间自动分给中央区域。

### 4.2 内容内部仍被固定最大宽度限制

当前关键约束：

- `MessageList.tsx`：消息项使用 `max-w-3xl`。
- `ChatComposer.tsx`：Composer 使用 `max-w-[800px]`。
- `UserMessageRow.tsx`：用户消息使用 `max-w-[620px]`。

结果是 Shell 在伸缩，但内容列仍保持固定窄宽，视觉上无法充分利用中央区域。

### 4.3 当前右侧面板职责过于固定

Workflow 作为永久右侧 Surface 会持续占据 360–460px。目标不是删除 Workflow，而是将其作为右侧工具坞中的“执行”视图，按需打开并复用现有数据和行为。

## 5. 目标信息架构

```text
┌──────────────────┬───────────────────────────────────────┬──────┬──────────────────┐
│ 整合侧栏         │ Agent 主工作区                       │ 工具坞│ 上下文面板       │
│                  │                                       │      │                  │
│ 新任务 / 搜索    │ 任务标题                              │ 执行 │ Workflow         │
│ 任务             │ 对话与执行摘要                        │ 文件 │ 文件与关联内容   │
│ 真实功能入口     │ Artifact / 宽内容                     │ 产物 │ Artifact         │
│ 最近 Session     │                                       │ 更多 │ 现有能力入口     │
│                  │ Composer                              │      │                  │
│ 账户 / 设置      │                                       │      │                  │
└──────────────────┴───────────────────────────────────────┴──────┴──────────────────┘
```

右侧面板关闭时只保留紧凑工具坞，中央主画布获得释放的全部空间。

## 6. Workspace Shell

### 6.1 布局原则

```css
.workspace-shell {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.workspace-main {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  container-type: inline-size;
}
```

- 左右 Surface 只管理自己的宽度与可见性。
- 中央不手动计算 `windowWidth - left - right`。
- 面板动画过程中不得卸载 Chat、丢失滚动位置或清空 Composer。
- 所有宽度动画遵守 Reduced Motion。
- 动画时间以 180–240ms 为主，避免长时间触发消息列表重排。

### 6.2 左侧整合侧栏

建议宽度基线：

- Wide/Desktop 展开：248–280px。
- 收起：完全隐藏或保留明确的单一展开入口，不额外保留第二条 rail。
- Tablet/Mobile：Drawer 或页面级 Surface。

内容顺序：

1. 收起与新任务。
2. 搜索。
3. 真实存在的稳定入口。
4. 固定与最近 Session。
5. 账户、连接状态、设置。

禁止：

- 为未来 Agent、资源或自动化提前显示无功能入口。
- 每个导航项都使用胶囊背景。
- 只通过右键菜单暴露重命名、归档和删除。
- 使用无文字状态点表达复杂运行状态。

### 6.3 右侧工具坞

工具坞保持窄、稳定、顺序固定，所有图标必须具备 Tooltip、选中状态与键盘焦点。

第一阶段只接入现有真实能力，至少包括：

- 执行：现有 Workflow panel。
- 其他入口只有在已有可用 Surface 时才出现。

上下文面板：

- Wide：约 380–480px，可并列。
- Desktop：有足够中央宽度时并列，否则覆盖。
- Tablet：覆盖。
- Mobile：全屏二级 Surface。
- 同一时刻只显示一个主要上下文面板。

## 7. ConversationFrame

### 7.1 目标

替换分散在消息、用户消息与 Composer 中的硬编码 `max-w-*`，用同一布局契约控制视觉轴线。

建议接口方向：

```tsx
<ConversationFrame mode="prose">...</ConversationFrame>
<ConversationFrame mode="user">...</ConversationFrame>
<ConversationFrame mode="wide">...</ConversationFrame>
<ConversationFrame mode="composer">...</ConversationFrame>
```

### 7.2 模式

#### `prose`

- Assistant 普通 Markdown、列表和短代码。
- 根据中央容器宽度增长，但保持约 70–90 个字符的主要阅读行长。

#### `user`

- 右对齐的紧凑用户消息块。
- 最大宽度随中央容器变化，但不横跨整个工作区。

#### `wide`

- 表格、Diff、日志、Workflow、图表和 Artifact。
- 可以突破普通正文列，使用中央区域的更大宽度。

#### `composer`

- 与主要消息视觉轴线一致。
- 宽屏可比正文略宽，窄屏使用 100%。

### 7.3 Container Query

内部组件根据中央区域真实宽度响应，而不是只看全局窗口：

```css
.workspace-main {
  container-type: inline-size;
}

@container (max-width: 720px) {
  .conversation-frame {
    max-width: 100%;
  }
}
```

具体阈值在原型和真实窗口中校准，不提前固化为未经验证的数字。

## 8. 对话区表达

### 8.1 用户消息

- 紧凑、右对齐或明显缩进。
- 使用低装饰消息块。
- 附件与引用作为结构化子内容。
- 编辑、复制、删除在 hover、focus 或显式菜单中出现。
- 触摸设备提供可见入口。

### 8.2 Assistant 内容

- 文档流，不使用大面积气泡。
- Assistant 身份只在回答开头或执行者变化时显示。
- Markdown 标题、正文、列表、表格与代码建立稳定层级。
- 宽内容使用 `wide` 模式，不强行压入窄正文。

### 8.3 Agent 执行信息

第一阶段不新增业务状态，只重新编排现有数据：

1. 主对话显示简洁执行摘要。
2. 现有可用步骤信息按需展开。
3. 完整 Workflow 和工具细节进入右侧执行面板。
4. 审批与阻塞错误继续保留在对话流。
5. 不直接展示原始内部推理。

## 9. Agent Composer

Composer 采用三层结构。

### 9.1 上下文条

仅在存在附件或关联内容时显示。第一阶段继续使用现有附件数据，不新增后端资源协议。

### 9.2 自适应输入区

- 空状态紧凑。
- 输入增多时向上增长。
- Desktop 与触摸设备拥有不同最大高度。
- 支持文件拖入、粘贴与现有上传进度。
- 不把装饰性图标放进正文输入区域。

### 9.3 稳定工具栏

保留现有真实能力：

- 添加附件。
- 当前 Preset。
- 当前模型。
- 发送。
- 运行中注入。
- 排队。
- 停止。

完整快捷键不长期显示为一整排 `kbd`。Tooltip、帮助与快捷键设置负责解释。

未来新增能力优先进入统一 `＋`、`/` 与 `@` 入口，但本轮不得为尚不存在的协议实现虚构行为。

## 10. 响应式 Surface 规则

### Wide

- 整合侧栏可常驻。
- 工具坞常驻。
- 上下文面板并列。
- 中央流体伸缩。

### Desktop

- 左侧栏保持可收起。
- 工具坞常驻，执行面板默认收起。
- 右面板根据中央剩余空间选择并列或覆盖。
- 第一阶段校准阈值：1024–1279px 使用覆盖面板，1280px 起改为并列伸缩；1536px 起使用 Wide 面板宽度。

### Tablet

- 左侧栏使用 Drawer。
- 右侧面板覆盖。
- hover-only 行为必须转为显式入口。

### Mobile

- 同时只展示一个主要 Surface。
- 对话、任务列表、执行面板与设置使用页面级切换。
- Composer 固定在当前对话 Surface 底部。
- 不将桌面三栏简单压缩。

开发顺序：Wide/Desktop → Compact Desktop → Tablet → Mobile。

## 11. 视觉与反 slop 约束

### 11.1 现在锁定

- 内容和交互优先。
- 一个主题一个主要强调色。
- 禁止无意义渐变、玻璃拟态和彩色发光。
- 阴影仅用于真实浮层、拖拽和必要的空间抬升。
- 不卡片化一切。
- 不滥用 Badge、胶囊、大圆角、Emoji 与装饰性状态点。
- 状态必须包含文字或可访问名称。
- 动效只解释变化，不使用 hover 放大和 `transition-all`。
- Mono 仅用于代码、路径、ID、参数、快捷键与需要字符对齐的测量值。

### 11.2 已选定的视觉方向

用户已于 2026-07-15 选择 **方案 B：柔和现代型** 作为第一阶段生产实现的视觉基线。

需要继承：

- 柔和但不暖纸化的中性表面。
- 克制的 terra/棕红强调色。
- 比方案 A 稍宽松的间距与圆角。
- 低干扰边界、无玻璃拟态、无彩色发光。
- 与方案 A 完全一致的信息架构、Agent 交互和响应式规则。

实施时仍需在真实 Electron 窗口中校准具体灰阶、字体、密度和控件尺寸；这些校准不得改变方案 B 的整体方向。

### 11.3 工作区壳层边界（2026-07-16）

主工作区的空间层级固定为“连续聊天画布 + 轻抬升辅助侧栏”，不得退回依赖整高、整宽硬分割线的表格式布局：

- Desktop/Wide 常驻会话侧栏内容宽度保持 `268px`，由 `AppShell` 在四周提供 `8px` 壳层间距；间距属于布局，不得挤占侧栏内部信息密度。
- 常驻会话侧栏允许使用 `12px` 圆角、低对比语义边界和 `--theme-surface-shadow`，用于表达侧栏相对聊天画布的轻微抬升。
- 常驻会话侧栏不得再使用贯穿全高的 `border-r` 作为主要分区手段；Tablet/Mobile Drawer 仍贴合视口边缘，并保留 Drawer 自己的方向边界。
- 中央聊天区保持连续画布，不增加外围卡片、整圈描边或大圆角，不通过多层嵌套 Surface 制造层级。
- 聊天与 Workflow 一级顶栏使用表面色和克制阴影建立层级，不使用高对比、贯穿整宽的 `border-b`；数据表、表单分组和面板内部工具栏仍可使用功能性边界。
- 阴影只用于壳层分离，不向会话行、消息流或普通内容块扩散；禁止玻璃模糊、彩色阴影和装饰性渐变。
- Electron 顶栏调整必须保留 `data-window-drag-region`、交互控件 `no-drag` 行为和 Windows 窗口控制按钮安全区。
- 修改壳层后至少验证 `1440 × 960`、`390 × 844`、侧栏开合动画以及 Workflow 常驻/覆盖两种状态。

## 12. 主题边界

普通用户主题以受控语义 token 为主：

- 背景与 Surface。
- 前景与辅助文字。
- 边界。
- 强调色。
- 语义状态色。
- 圆角尺度。
- 阴影尺度。
- 字体与字号。
- 密度与间距。
- 消息与 Composer 表面。

未来高级 CSS：

- 只通过公开 CSS Variables 与稳定 `data-*` 选择器。
- 明确标记为高级能力。
- 不承诺内部 Tailwind class 或 DOM 结构稳定。
- 必须提供恢复默认和故障安全路径。

## 13. 组件与技术策略

保留 React、Tailwind、Radix、Framer Motion、Ladle 和当前共享层。

第一阶段可能新增或重构：

- `WorkspaceShell`
- `IntegratedSidebar`
- `ContextToolDock`
- `ContextPanel`
- `ConversationFrame`

业务 Feature 继续组合共享组件，不建立新的平行业务实现。

禁止：

- 引入新的大型 UI 库。
- 全量 shadcn 化。
- 为目录整齐而移动全部文件。
- 全局机械替换圆角和颜色。
- 在同一提交中混入无关 Prettier/style churn。

## 13.1. 当前 PR 自检门槛

- `npm run quality.format` 只检查当前变更文件：CI 会根据 PR 或 push 的提交范围传入 `--from` / `--to`；本地还会包含 staged、working-tree 和未忽略的 untracked 文件。
- `npm run quality.format.full` 与 `npm run quality.format.full.fix` 保留为需要时的全仓人工检查，不作为普通 PR 的自动门槛。
- `npx tsx Scripts/VerifyFrontendRuntimeI18n.ts` 扫描 `Frontend/src` 产品源码，开发样例和设计系统 story 目录除外；产品可见字符串必须来自 catalog。Electron 主进程托盘、启动失败和设置窗口文案使用 `Apps/Desktop/DesktopMessageCatalog.ts`，不能直接写中文 UI 文案。
- Node 开发环境变更后使用 `npm run desktop.restore` 重建 `better-sqlite3`；Electron 打包流程仍由桌面打包脚本按 Electron ABI 单独处理。

## 14. 第一阶段纵向切片

真实路径：

```text
打开应用
→ 查看 Session 列表
→ 选择或新建 Session
→ 阅读消息
→ 输入并发送
→ Agent 运行
→ 查看 Workflow
→ 开合左右 Surface
```

第一阶段按顺序实施：

1. 建立 Workspace Shell 与宽度契约。
2. 将左侧改为整合侧栏，保持现有 Session 行为。
3. 建立右侧工具坞，将现有 Workflow 接入执行面板。
4. 引入 `ConversationFrame`，移除三处分散最大宽度。
5. 调整 MessageList、UserMessageRow 与宽内容排版。
6. 重组 Composer，但保持现有发送、上传、Preset、模型、注入、排队和停止行为。
7. 校准必要 primitives、tokens 与 motion。
8. 完成 Desktop、Tablet、Mobile 适配。
9. 真实 Electron 窗口验证。

## 15. 预计文件影响范围

第一阶段重点文件：

- `Frontend/src/layout/AppShell.tsx`
- `Frontend/src/features/session/SessionList.tsx`
- `Frontend/src/features/session/SessionChrome.tsx`
- `Frontend/src/features/session/SessionPanelBody.tsx`
- `Frontend/src/features/session/SessionRows.tsx`
- `Frontend/src/features/session/ProfileFooter.tsx`
- `Frontend/src/features/chat/ChatPanel.tsx`
- `Frontend/src/features/chat/ChatHeader.tsx`
- `Frontend/src/features/chat/MessageList.tsx`
- `Frontend/src/features/chat/MessageRow.tsx`
- `Frontend/src/features/chat/UserMessageRow.tsx`
- `Frontend/src/features/chat/AssistantMessageBody.tsx`
- `Frontend/src/features/chat/ThinkingSummaryBar.tsx`
- `Frontend/src/features/chat/ChatComposer.tsx`
- `Frontend/src/features/workflow/*` 中现有 Workflow Surface 入口
- `Frontend/src/shared/ui/*` 中被纵向切片使用的 primitives
- `Frontend/src/shared/responsive/*`
- `Frontend/src/shared/motion/*`
- `Frontend/src/shared/theme/*`
- `Frontend/src/index.css`

此清单表示审查范围，不表示必须一次性修改全部文件。

## 16. 验证要求

### 自动验证

按改动范围逐步执行：

- 前端类型检查。
- 前端行为测试。
- 前端完整测试。
- 前端构建。
- 与响应式布局、消息虚拟列表、设置打开路径相关的现有验证。

具体命令以实施时 `package.json` 当前脚本为准，不在方案文档中固化可能漂移的命令名称。

### 人工验证

至少覆盖：

- 1440×960：左右面板、长消息、运行中 Composer。
- 1280×800：右面板降级和中央可读性。
- 900px 左右：Tablet Drawer/Overlay。
- 390×844：Mobile 对话、Composer 和 Surface 切换。
- 长代码、宽表格、长文件名、大量附件。
- 左右面板开合时滚动位置与输入内容不丢失。
- Light、Dark 与 Reduced Motion。
- 键盘、鼠标和触摸。

布局、窗口路由或面板行为变化后，必须进行真实 Electron 窗口检查，自动测试不能替代。

## 17. 回滚与兼容策略

- 每个阶段保持现有业务组件可运行。
- 不先删除旧 Workflow Surface，再实现新工具坞。
- 不同时改事件投影和布局。
- 新旧布局切换期间如需兼容层，应短期、可删除且不复制业务逻辑。
- 每个阶段单独验证，避免一个巨大不可审查的重构提交。

## 18. 原型审查门

生产前端修改前必须先完成：

1. 本方案审查：已完成。
2. 中性技术型原型：已完成。
3. 柔和现代型原型：已完成。
4. 左右 Surface 开合：已验证。
5. Wide、Desktop、Tablet、Mobile 状态：已提供。
6. 普通消息、长代码、Agent 运行与 Workflow 面板：已提供。
7. 用户视觉选择：**方案 B，已完成**。
8. 用户明确批准开始生产实施：**已于 2026-07-15 获得，第一阶段已完成**。

原型只验证前端表现，不模拟完整 WebSocket、上传、审批或持久化。

## 19. 决策摘要

| 决策             | 结论                                 |
| ---------------- | ------------------------------------ |
| 中央伸缩         | 保留 AppShell Flex，重构内部宽度系统 |
| 左侧             | 单一整合侧栏                         |
| 右侧             | 工具坞 + 按需上下文面板              |
| Workflow         | 复用现有能力，迁入执行面板           |
| 对话             | 用户紧凑消息 + Assistant 文档流      |
| 宽内容           | 独立 `wide` 模式                     |
| Composer         | 上下文条 + 输入区 + 稳定工具栏       |
| 响应式           | 共享组件，不同 Surface 编排          |
| 主题             | 受控 token 优先，高级 CSS 后置       |
| 视觉             | 现代 Agent 工作台，反 slop           |
| 技术栈           | 保留现有 React/Tailwind/Radix/Framer |
| 实施             | 主工作区纵向切片优先                 |
| 后端             | 本轮不修改                           |
| Agent Definition | 独立延期路线图                       |

## 20. 下一步

方案 B 已被选定并完成第一阶段纵向切片。本节记录 2026-07-15 当时的交付门；后续提交已继续完成主题语义化、设置工作台宿主、配置即时保存与前端 i18n 收敛。后续扩展仍不得自动扩大到后端、Agent Definition 或全应用重构。

## 21. 第一阶段实施结果（2026-07-15）

已完成：

- Desktop/Wide 左侧改为单一整合侧栏；收起后宽度为 0，不保留第二条 rail。
- 增加真实会话搜索，并保留新建、选择、重命名、删除、账户和设置行为。
- 右侧拆分为常驻执行工具坞与按需执行面板；新用户默认收起执行面板。
- 1024–1279px 使用覆盖面板，1280px 起并列参与中央 Flex 伸缩，1536px 起使用 460px Wide 面板。
- 新增 `ConversationFrame`，统一 `wide`、`prose`、`user` 与 `composer` 内容轴线。
- Assistant 使用文档流；正文保持可读行长，代码、表格和 Artifact 保留更宽空间。
- 用户消息改为紧凑低装饰块；Composer 重组为附件上下文、增长输入区和稳定底部工具栏。
- Tablet/Mobile 继续使用 Drawer/Overlay，共享原有业务组件与命令链。
- 未修改后端 API、WebSocket、Runtime、Session 语义、审批策略或 Agent Definition。

验证结果：

- 前端类型检查通过。
- 前端测试治理通过，共 64 个 Vitest 文件。
- 前端行为测试通过，共 277 个测试。
- 前端生产构建通过。
- `git diff --check` 通过。
- 真实浏览器覆盖 1600×960、1440×960、1280×800、900×800 与 390×844；验证左右 Surface 开合、长会话、执行图和 Composer。
- `kill-ai-slop` 复扫由初始 180 个静态命中降至 169 个；剩余命中主要是代码折叠渐变、品牌 Logo、真实进度/开关/头像和技术值 Mono 等已审查项。

当时的第一阶段到此停止（历史记录）：不自动进入主题任意 CSS、Agent Definition、全设置区迁移或后端重构。后续主题与设置范围已在本文件后续提交记录中按用户批准继续实施；该句不再表示当前仓库状态。

## 22. 第二轮去 slop 收敛（2026-07-15）

用户基于真实界面截图指出第一阶段仍存在系统性的视觉 slop。本轮按“先减法、后层级”的原则继续收敛，仍不改变后端和业务语义。

已完成：

- 移除装饰性多色波形 SVG、Fraunces 斜体字标和固定品牌紫色；Logo 改为继承主题的中性 Sans 文本/字母标记，空状态不再重复展示品牌图形。
- Session 行改为扁平列表：移除常驻会话图标、彩色左侧激活线和卡片阴影；空闲会话隐藏低价值副标题，更多操作仅在 Hover、键盘焦点或触摸模式下出现。
- 消息流移除常驻 Assistant 图标卡；用户头像缩为 24px，时间仅在 Hover/Focus 时显示；复制保留直达，其余 Workflow、重新回答和删除动作合并到单一更多菜单。
- 执行摘要从带灯泡图标的整行卡片改为回复后的单行文本 disclosure；详情使用分隔列表，不再嵌套卡片、状态圆点和左侧装饰线。
- Composer 保留一个主要结构边界，移除内部工具栏分割线、厚焦点光晕和禁用发送按钮的实心占位块。
- Workflow 顶栏、运行选择器和指标条改为同一信息层级，不再使用选择器卡片、状态徽章和重复标题。
- Workflow 节点移除彩色 icon tile、重复状态点、节点阴影和彩色 Scope 卡；长执行图默认聚焦最近/运行中节点，保留“适配全图”控制供用户切换总览。
- Workflow 节点详情将 pill metadata 改为 definition list，Skeleton、错误和结果预览也改为扁平内容结构。
- 保留上传进度、开关、头像裁剪、代码/数据 Mono、Dropdown/Dialog 边界等具有明确功能语义的视觉模式。

验证结果：

- 前端类型检查通过。
- 前端测试治理通过，共 64 个 Vitest 文件。
- 前端行为测试通过，共 278 个测试；新增消息更多菜单可达性覆盖。
- 前端生产构建通过。
- `git diff --check` 通过。
- `kill-ai-slop` 静态命中从第一阶段后的 169 降至 148。剩余命中经人工归类，主要为真实上传进度、Toggle、头像/裁剪圆形、菜单和对话框边界、技术数据 Mono、代码折叠渐变及 Story 示例；不以机械归零破坏功能。

本轮尝试通过 Codex 内置浏览器访问本机 Vite 预览，但浏览器网络环境无法访问宿主机 `127.0.0.1`；因此第二轮变更没有伪造“已完成真实窗口截图验证”的结论。下一次在 Electron 或可访问宿主机 localhost 的浏览器会话中，应按第 16 节尺寸矩阵做最终视觉复核。
