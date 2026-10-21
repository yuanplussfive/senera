# 前端工作区布局标准

这是桌面对话工作区的设计原则文档,约束外壳、侧栏、顶栏、内容轨道、输入区、右侧功能坞和加载骨架的布局行为。

**边界**:代码是唯一数值真源;本文只维护原则和结构性约定,不复述像素值。不要为这些数值新增像素/几何测试,也不要把本文变成 CI 强制项。已有交互行为测试(拖拽区归属、焦点跟随、无障碍属性)不受此限制。

## 1. 核心原则

- **8px 网格**:区域级间距取 8 的倍数;行内光学微调(工具行内部、图标校正、带边框行的内距)允许非网格值,但必须有光学理由。
- **侧栏流式宽度**:默认按窗口宽度比例计算并设上下限,不做固定宽度;用户手动调整后保留用户值,只做边界钳制。
- **三级留白**:窗口/面板外缘、面板与主区、内容轨道内缘三级递减,数值见代码 token。
- **单一内容锚线**:顶栏标题、助手头像、输入卡共用内容轨道左缘;锚线用容器查询(`100cqw`)计算,不使用 `window.innerWidth`。
- **阅读优先**:阅读列按字符数控制,中文正文约 55–75 字,不铺满窗口。
- **邻近表达归属**:回合之间 > 回合内部 > 工具轨迹内部,间距逐级收紧。
- **悬停 chrome 单行**:时间、token、复制和更多合并为一行;显隐由消息尾部单一容器控制,子组件不各自再挂 hover 显隐。

## 2. 结构性约定

- 侧栏卡片宽度跟随外壳(`calc(100% - 外缘*2)`);展开/收起由外壳宽度动画驱动,卡片不另设独立 width 过渡。
- 窗口小于 1024px 时侧栏转为抽屉,不参与持久侧栏宽度计算。
- 顶栏标题左内距用 `max()` + 容器查询对齐内容轨道;窗口控制区或 top chrome 高度变化时,同时检查顶栏、标题锚线和加载骨架。
- 轨道宽度是上限:窄内容保持自然宽度,长内容在阅读列内换行。
- 输入卡与内容轨道共用左锚线;功能坞是悬浮层,不挤压正文。
- **Electron 拖拽区归属**:Electron 从布局盒(而非 paint 或 pointer-events)计算拖拽区。同一时刻只允许可见表面的 header 携带 `data-window-drag-region`;隐藏表面必须摘掉该属性,否则会继续吞掉可见区域的点击。标题栏背景条只做视觉,不携带拖拽属性。
- 加载骨架的侧栏、输入区和功能坞尺寸公式与真实表面同源(同一 CSS 类或同一计算公式),避免骨架与真实布局脱节。

## 3. 数值去哪看

| 区域                       | 唯一真源                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| 侧栏宽度/折叠轨道/拖拽范围 | `AppShell.tsx` 顶部常量与 `readDefaultSessionPanelWidth`                                           |
| 侧栏卡片内距/行高          | `SessionList` / `SessionPanelBody` / `SessionRows`                                                 |
| top chrome / 窗口控制区    | `--senera-top-chrome-height` / `--senera-window-controls-width`(`index.css`)                       |
| 顶栏锚线                   | `.chat-header-shell`(`index.css`)                                                                  |
| 轨道/阅读列/气泡上限       | `.conversation-frame` / `.assistant-turn-content` / `.conversation-frame--user > div`(`index.css`) |
| 消息间距/工具行节奏        | `MessageList` 与 `--theme-chat-*` gap token(`index.css`)                                           |
| 输入卡                     | `ChatComposer`                                                                                     |
| 功能坞                     | `AppShell.tsx` 的 `WORKFLOW_DOCK_*` 常量与 `--senera-top-rail-gap`                                 |
| 加载骨架                   | `SurfaceLoading` / `ChatLoadingSurface` 与 `.app-loading-sidebar`                                  |

## 4. 视觉参考

- `docs/design/chat-spacing-rhythm/chat-spacing-rhythm.html`:完整工作区的前后对照、间距标注和 token 表。
- `Frontend/src/shared/ui/ConversationFrame.stories.tsx` 的 `WidthModes`:共享内容框的视觉参考。

Story 和原型用于视觉评审,不是自动约束。Ladle 不挂载完整 `AppShell` / `SessionList` / `ChatComposer` 运行时,因此不要用 Story 冒充应用级布局测试。

## 5. 变更方式

修改本文涉及的区域时:

1. 先在原型页或实际界面确认 1024 / 1280 / 1440 宽度下的效果。
2. 数值改代码即可,不需要回填本文;只有原则或结构性约定变化时才更新本文。
3. 不需要为间距数值新增测试。
