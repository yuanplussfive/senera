# Senera 前端视觉一致性重构草案

- 状态：**讨论草案 / Agent handoff / 尚未授权实施**
- 草案日期：2026-07-29
- 适用仓库：`D:/AI/sentra-agent-v2/senera`
- 观察分支：`codex/frontend-polish`
- 主要方法：`kill-ai-slop` 扫描与人工复核、`emil-design-eng` 的层级/反馈/动效原则、仓库既有前端与 Ladle 约束

> 这不是一个“把扫描器报错全部清零”的任务，也不是一份已经确认的视觉规范。它把两张当前界面截图、真实代码位置、扫描信号和候选方案组织成可审查上下文，供任意 Agent 继续 Review、拆解或实施。任何 Agent 在修改代码前，都必须先重读当前文件、确认 Git 工作区归属，并向用户确认仍未决的产品选择。

## 0. 给接手 Agent 的最短指令

1. 先阅读本文全文，再阅读：
   - `Frontend/AGENTS.md`
   - `docs/Development/FrontendMotionPolicy.md`
   - `docs/Development/FrontendLadleConstraints.md`
   - `docs/frontend-kill-slop-audit.md`
2. 执行 `git status --short --branch`，不要覆盖当前未提交工作。
3. 把本文中的内容按证据等级理解：截图观察与代码事实优先；扫描命中只是线索；候选方案允许反驳。
4. 先 Review，再实施。Review 至少要回答：
   - 根因判断是否成立；
   - 方案是否在修视觉层级，还是只换颜色/圆角；
   - 是否引入新的状态歧义、布局跳变、无障碍回退或 Story 假实现；
   - 哪些未决选择必须由用户确认。
5. 如果获得实施授权，按本文 Phase 顺序做小而可审查的改动，不要一次性全局换肤，不新增依赖，不顺手重构无关业务。

## 1. 为什么需要一份新草案

仓库已有 `docs/frontend-kill-slop-audit.md`，其基线始于 2026-07-14，主要记录上一轮扫描、已修项、保留项和回归规则。它仍是重要约束，但不能完整解释这次截图暴露出的系统性问题：

- 旧报告把若干几何、三栏、等宽字和恢复骨架解释为“有明确功能意义的保留项”；
- 新截图与用户实际感受表明，问题已经不是单个 slop 命中，而是**主题强调色、语义状态色、错误恢复、加载连续性、工作台信息架构、图标语法和 Story 质量之间缺乏统一产品语言**；
- 因此本文不推翻旧报告的全部结论，而是补充更高层的视觉一致性与状态设计审查。若两者对具体组件结论冲突，应以最新运行界面、当前代码和重新 Review 为准。

## 2. 目标、非目标与成功定义

### 2.1 目标

把 Senera 从当前并存的三种视觉方言，收敛为一个可复用的产品语言：

1. **暖白、克制、内容优先的主工作区**；
2. **状态具有独立语义，不与品牌强调色争夺含义**；
3. **错误先提供恢复路径，技术诊断按需展开**；
4. **加载保持空间与上下文连续，不伪造未知内容**；
5. **复杂编辑器以任务层级组织，而不是把所有能力平铺成 IDE 工具条**；
6. **图标、按钮、状态、空状态和 Story 使用同一套组件契约**。

工作名可称为：**安静的暖色工作台**。这只是方向描述，不是要求所有界面变成米色或低对比度。

### 2.2 非目标

- 不在本草案中确定最终 RGB/HSL 数值；
- 不要求更换 Lucide 图标库；
- 不以扫描命中数归零为目标；
- 不在结构问题解决前批量增加动画；
- 不重写会话、预设、模型或错误协议的业务逻辑；
- 不为了展示候选方案把 A/B 变体长期塞进生产 Story；
- 不新增前端依赖；
- 不在未确认归属时修改、删除、格式化或提交当前脏工作区文件。

### 2.3 成功定义

用户在不阅读说明的情况下应能分辨：

- 哪个元素是当前选择/主操作；
- 哪个状态是进行中、警告、失败、成功或不可用；
- 失败后下一步可以做什么；
- 当前看到的是已有内容、恢复中的内容，还是新建但未保存的草稿；
- 一个图标是品牌、导航、状态还是操作，而不是装饰；
- 加载前后页面的主要空间关系保持稳定。

## 3. 证据等级与审查口径

| 等级 | 含义                   | 本文写法             | Review 时如何处理                        |
| ---- | ---------------------- | -------------------- | ---------------------------------------- |
| E1   | 截图或运行界面直接可见 | “截图显示……”         | 可作为当前体验事实，但仍需在最新构建复现 |
| E2   | 当前源码人工确认       | 给出文件与组件       | 修改前重读文件；行号会漂移               |
| E3   | 扫描器启发式信号       | 给出组名与命中数     | 不能直接等同缺陷，必须逐项 triage        |
| H1   | 基于证据的根因假设     | “推测/可能/候选根因” | Agent 应尝试反证                         |
| P1   | 候选改良方向           | “建议/候选契约”      | 需要设计 Review 或用户确认后实施         |

严禁把 E3 写成“发现 159 个 UI bug”，也严禁把个人偏好包装成可访问性结论。

## 4. 输入材料

### 4.1 截图 A：会话失败状态

原始临时路径：
`C:/Users/ADMINI~1/AppData/Local/Temp/codex-clipboard-99c52b2c-d6d4-40ca-b032-a6b3ec7fb6b5.png`

临时路径可能失效，因此保留文字快照：

- 左侧为暖灰会话侧栏，当前会话以浅橙背景选中；
- 主区顶部有橙色描边的“失败”状态胶囊；
- 会话中央直接显示一整段橙色技术错误：
  `Interaction Router 生成失败：action_planner_model_request_failed: 模型请求失败。 status=404 model=mistral-large-latest endpoint=ChatCompletions baseUrl=http://localhost:3000/v1 detail=`；
- 错误文本悬浮在大面积空白中央附近，没有明确标题、重试、切换模型、检查配置或复制详情入口；
- 用户消息仍在右上区域，输入框固定在底部，错误与会话因果关系较弱；
- 顶部失败、正文错误、沙箱不可用、会话选中和主操作都落在相近暖橙色域，语义互相污染。

### 4.2 截图 B：角色预设工作台

原始临时路径：
`C:/Users/ADMINI~1/AppData/Local/Temp/codex-clipboard-2127f053-42d5-45d6-857f-7a4c2c24dc54.png`

文字快照：

- 一个接近全屏的 `角色预设` Dialog 覆盖主界面；
- 左栏同时显示“本地预设 / 0 个文件 / 暂无预设”，但中间已经出现名为 `roleplay-preset` 的编辑草稿；
- 顶部工具条同时铺开：状态、文件名、格式切换、启用、删除、保存、保存并启用；
- 中间是大面积空白编辑器；
- 右栏持续展示 `0 token / 0 字符 / 1 行 / 0 字节 / .md / 名称 / 状态`；
- 视觉上更接近旧式 IDE/后台管理器，而不是与主会话一致的轻量产品工作流；
- 空内容时大量边框、分栏、指标与操作仍保持高存在感，任务焦点不明确。

### 4.3 当前扫描基线（2026-07-29）

命令：

```powershell
node C:\Users\Administrator\.agents\skills\kill-ai-slop\scripts\scan.mjs Frontend/src --json
```

结果：`327` 个文件，`12` 个信号组，`159` 个原始命中。

| 组                              | 原始命中 | 解释                                                      |
| ------------------------------- | -------: | --------------------------------------------------------- |
| gradients as atmosphere         |       19 | 页面/主题氛围渐变与少量内容遮罩混在一起，需人工区分       |
| decorative strikes & highlights |        1 | 当前命中可能只是正常链接下划线                            |
| flat type hierarchy             |        1 | Story 中的层级线索，不代表生产 UI 已确认缺陷              |
| glowing status dot              |        8 | 包含真正的进行中反馈，也包含可能过度的 pulse              |
| max-radius / glassmorphism      |       30 | 包含头像、进度条、气泡等合法几何，也有重复胶囊信号        |
| oversized drop shadow           |        1 | 单点检查                                                  |
| corners that do not nest        |        7 | 需结合真实嵌套关系判断                                    |
| border dies at the corner       |        8 | 需检查裁切与边框是否同属一个元素                          |
| all-caps card grid              |        3 | 主要是三列结构/Story，不能机械判错                        |
| one gap everywhere              |        1 | 单点层级信号                                              |
| Inter everywhere                |        2 | 字体声明信号，不等于必须换字体                            |
| tasteful-terminal               |       78 | 大量等宽字有技术语义；需筛出被错误用于普通描述/状态的部分 |

扫描器的价值是暴露“重复使用同一种视觉手段”的位置，不是替代界面判断。本轮人工确认的重点不是 159 个命中，而是下文 F-01 至 F-07。

## 5. 总体诊断：当前同时存在三种视觉方言

### 方言 A：暖白、低噪声的会话产品

优点：品牌辨识度清楚，主界面不依赖常见蓝紫渐变，暖白纸面与深墨文字有自己的性格。

问题：terra 强调色承担了过多角色——选择、主操作、活跃、警告、错误，导致“唯一强调色”逐渐变成“所有重要东西都是橙色”。

### 方言 B：裸露的运行时/调试状态

表现：长错误串作为一行 `InlineError` 直接进入会话，用户必须自己解析状态码、模型、端点和 base URL。

问题：这是后端日志的视觉包装，不是产品恢复流程。它既没有聊天消息的因果结构，也没有面板错误的恢复结构。

### 方言 C：密集的 IDE/后台管理工作台

表现：预设 Dialog 的三栏、持续可见指标、多个并列动作、文件格式分段器、信息检查器。

问题：它不是“复杂所以专业”，而是缺乏任务优先级。新建空预设时，系统仍展示与当前决策无关的统计和文件元数据。

### 统一方向

不是把三者强行做成相同布局，而是统一以下语法：

- 同一种语义状态使用同一 token 与组件契约；
- 同一级任务使用相似的信息密度与主次动作；
- 边框只在需要解释结构时出现；
- 空白用于聚焦，不用于把错误孤立在画布中央；
- 技术细节保留，但默认不抢占用户任务；
- 动效只负责反馈、连续性和空间关系，不负责掩盖结构问题。

## 6. 详细发现与改良方向

### F-01：品牌强调色与状态色发生语义碰撞

**优先级：P0**

**证据：E1 + E2**

#### 代码锚点

- `Frontend/src/shared/theme/themeModel.ts`
  - `semanticColorAliases` 主要定义 surface、content、accent 等角色；
  - 当前没有完整的一等 `success / warning / danger / info` 角色族。
- `Frontend/tailwind.config.js`
  - `terra`：唯一强调色；
  - `moss`：完成态；
  - `umber`：进行中；
  - `brick`：错误。
- `Frontend/src/shared/theme/themeData/palettes/seneraPalette.ts`
  - 默认浅色 `terra` 与 `brick` 都落在暖橙/焦土区域；
  - `brick-500` 当前值为 `217 119 6`，视觉上比命名“砖红”更接近琥珀橙；
  - `umber` 也处在暖棕色域。

#### 用户影响

- “被选中”“现在进行中”“需要注意”“已经失败”主要依靠相邻暖色区分；
- 顶部失败胶囊、正文错误、当前会话和部分警告同时出现时，用户只能依赖小图标或文案重新解释颜色；
- 品牌强调色失去稀缺性，主操作与危险/失败状态相互削弱。

#### 候选根因

当前 token 体系把**色板名**当成了**语义角色**。组件调用 `text-brick-600` 或 `bg-umber-50` 时，知道的是颜料，不是“这是危险文字/警告表面/进行中图标”。换主题或微调色相时难以系统验证。

#### 改良方向

先定义语义角色，再映射到色板。候选结构：

```text
status.success.content / surface / border / icon / solid
status.warning.content / surface / border / icon / solid
status.danger.content  / surface / border / icon / solid
status.info.content    / surface / border / icon / solid
```

CSS 变量可采用类似：

```css
--status-danger-content
--status-danger-surface
--status-danger-border
--status-danger-icon
--status-danger-solid
```

具体命名需遵守现有主题模型，以上只表达契约，不是强制 API。

建议原则：

1. `terra/accent` 只表示当前选择、焦点与主要交互；
2. success/warning/danger/info 不随用户 accent 任意漂移；
3. 状态不能只靠颜色，必须配合稳定文案、图标或形态；
4. 大段错误正文优先使用正常正文色，危险色只标记标题、图标、边界或关键短语；
5. 先验证浅色和深色，再决定最终色相；不要只把 `brick` 改得更红就结束。

#### 验收标准

- 同屏放置 active、running、warning、failure、success 时，灰度观察仍能通过结构/文字区分；
- 切换 accent 后，错误和警告的语义不改变；
- 所有状态组合满足项目对比度要求，但不以“勉强通过对比度”替代语义区分；
- Story 中有一张真实状态矩阵，而不是单纯色板展示。

#### 风险

- 全局改色可能影响终端、连接状态、插件诊断等大量调用点；
- 若直接替换所有 `brick/umber`，会误伤代码语法色或业务上合法的技术颜色；
- 应先建立映射和调用点清单，再迁移关键路径。

### F-02：会话运行失败被当作行内表单错误

**优先级：P0/P1**

**证据：E1 + E2**

#### 代码锚点

- `Frontend/src/features/chat/SystemMessageRow.tsx`
  - 当前把全部 system message content 放入 `InlineError`；
  - 使用 `mx-auto max-w-md`，因此长错误串在会话中形成孤立的窄文本块。
- `Frontend/src/shared/ui/StateView.tsx`
  - `InlineError` 的注释与 API 明确面向“表单/行内错误”；
  - `StateView` 面向面板/列表三态；
  - 二者都不是一次聊天运行失败的完整契约。

#### 用户影响

- 用户看到“发生了什么”，但看不到“现在能做什么”；
- 技术字段与人类可读说明处在同一层级；
- 错误与触发它的用户消息、模型或运行步骤关联弱；
- 失败后继续输入、重试、切换模型、打开设置之间没有明确优先级。

#### 改良方向

新增或抽象一个**聊天运行失败状态**，名称暂定 `ChatRunFailure` / `RunFailureView`，不要把 `InlineError` 膨胀成万能错误组件。

候选内容层级：

1. 简短标题：例如“这次运行没有完成”；
2. 一句可行动说明：例如“当前模型端点返回 404，可重试或检查模型配置”；
3. 主恢复动作：根据错误类型选择 `重试`、`重新连接` 或 `打开模型设置`，同一时刻只突出一个；
4. 次动作：`更换模型`、`复制诊断信息`；
5. 可折叠技术详情：error code、status、model、endpoint、base URL、detail；
6. 与对应运行/消息保持在会话流内，不漂浮成全局空状态。

错误呈现的四级边界建议：

| 级别      | 组件职责                   | 示例                           |
| --------- | -------------------------- | ------------------------------ |
| 字段/行内 | `InlineError`              | 输入校验、单行操作失败         |
| 面板/列表 | `StateView status="error"` | 某个数据面板加载失败           |
| 会话运行  | 新的 run failure 组件      | 模型请求、规划、工具链运行失败 |
| 应用致命  | `ErrorBoundary`            | 页面无法继续渲染               |

#### 验收标准

- 默认视图不泄漏整段后端拼接字符串；
- 技术字段仍可访问、复制，并可用于支持排障；
- 键盘与读屏能识别失败通知和恢复动作；
- 重试中、重试失败、重试成功不会创建重复错误卡或布局跳跃；
- 长 base URL、空 detail、未知错误码和多语言文案都有测试/Story。

#### 风险

- 当前 system message 可能承载不止错误；实施前必须确认消息 schema 和来源；
- 不能仅用字符串正则长期解析错误，优先确认后端是否已有结构化字段；
- 若协议暂时只能提供字符串，需要明确临时适配层和未来移除条件。

### F-03：恢复骨架伪造未知会话，导致错位与视觉跳变

**优先级：P1**

**证据：E1（用户反馈）+ E2 + E3**

#### 代码锚点

- `Frontend/src/features/chat/HistoryRecoveryState.tsx`
  - 生成 1–6 组交替的 user/assistant skeleton；
  - 用户气泡使用固定比例宽度；
  - assistant 使用固定最大宽度和模拟 meta/content 行；
  - 视觉上预先猜测真实消息角色、长度和高度。
- `Frontend/src/app/SurfaceLoading.tsx`
  - 在应用 surface loading 时绘制一套假的设置/工作台壳层与脉冲块。

#### 用户影响

- 骨架布局与真实消息数量、角色、附件、工具调用和文本高度不一致；
- 加载结束后，用户眼前的空间模型被整体替换，产生“错位”“闪一下”“内容从错误位置跳出来”的感受；
- 模拟内容越具体，错误承诺越明显。

#### 原则

**Skeleton 只能表示已知布局中的未知内容，不能虚构未知布局。**

#### 改良方向

按场景选策略，不建立一个全局万能 skeleton：

1. **已有会话内容、正在后台补恢复**：保留旧内容，在边缘放一条低噪声恢复状态；
2. **知道消息记录数量与角色，但正文未到**：可按真实元数据保留槽位；
3. **完全不知道历史结构**：使用一个中性恢复行/区域，不画假用户与假助手对话；
4. **短加载**：设置延迟阈值，避免亚秒级闪烁。具体阈值需测量，候选从约 300–400ms 开始；
5. **应用壳加载**：尽量先渲染真实稳定 chrome，只对局部未知区域加载；不要复制一份迟早会漂移的假工作台。

#### 动效边界

- 结构稳定前不做大面积 shimmer；
- 若有 presence/高度过渡，复用 `Frontend/src/shared/motion` 和 `useMotionLevel`；
- reduced/none 模式仍需保持信息完整；
- 不对实时追加的长会话内容做逐项花哨入场。

#### 验收标准

- loading → content 的主容器位置和宽度稳定；
- 不再出现与真实会话角色/消息数不符的假对话；
- 390、900、1440、1600 宽度下无明显滚动位置漂移；
- 测试覆盖短加载不闪骨架、慢加载可感知、恢复失败可重试、恢复成功保留滚动锚点。

### F-04：空状态文案和结构过于泛化，像 AI 默认占位

**优先级：P1/P2**

**证据：E2**

#### 代码锚点

- `Frontend/src/features/chat/EmptyChatState.tsx`
- `Frontend/src/i18n/messages/zh-CN.json`
  - 当前标题：“今天想做点什么？”
  - 建议：“整理今天的工作优先级”“分析一段错误日志”“把需求拆成可执行步骤”。
- `Frontend/src/features/chat/PresetSidebar.tsx`
  - 空预设列表主要复用居中 `StateView`，只显示“暂无预设”类说明。

#### 用户影响

- 建议语句适用于几乎任何 AI 助手，没有传达 Senera 的具体能力、当前上下文或下一步；
- 空状态没有解释“为什么为空”和“完成首个结果所需的最短动作”；
- 多个页面共用“图标 + 标题 + 描述 + CTA”的抽象时，容易生成同一种模板脸。

#### 改良方向

空状态按原因分类，而不是按视觉模板分类：

| 原因           | 应回答的问题       | 示例动作             |
| -------------- | ------------------ | -------------------- |
| 初次使用       | 这里能完成什么     | 选择一个真实起步任务 |
| 当前筛选无结果 | 为什么看不到已有项 | 清除筛选             |
| 尚未创建对象   | 创建后会得到什么   | 新建/导入            |
| 权限/连接缺失  | 缺少什么前置条件   | 连接/授权            |
| 恢复中         | 系统正在做什么     | 通常不需要 CTA       |

聊天首页建议使用真实、可执行、能体现产品流程的入口；数量少、语气直接，不加营销副标题，不为了“丰富”增加插画、emoji、虚构统计或卡片阵列。

预设空状态应明确区分：

- 没有已保存预设；
- 当前有一个未保存草稿；
- 搜索没有匹配；
- 目录尚未同步；
- 导入失败。

#### 验收标准

- 去掉产品名后，文案仍能描述 Senera 的实际任务，而不是任何聊天机器人；
- 每个空状态只有与原因匹配的下一步；
- “0 个文件”与“正在编辑草稿”可以同时成立且不矛盾；
- 不把插画当作空状态完成度的指标。

### F-05：预设工作台把所有能力平铺，缺乏任务层级

**优先级：P1**

**证据：E1 + E2**

#### 代码锚点

- `Frontend/src/features/chat/PresetPanel.tsx`
  - `DialogContent` 接近全视口；
  - 主体固定为左侧列表 / 中央编辑 / 右侧检查器三栏。
- `Frontend/src/features/chat/PresetWorkspace.tsx`
  - 顶部同时放状态、文件名、格式、启用/禁用、删除、保存、保存并启用；
  - 右侧持续展示 token、字符、行数、字节、格式与文件信息；
  - `StatusPill` 同时处理 busy/dirty/active/idle；
  - 格式使用三段式开关。
- `Frontend/src/features/chat/PresetSidebar.tsx`
  - 列表为空时，中央仍可能存在新草稿编辑状态。

#### 用户影响

- 新建一个空预设时，用户面前同时出现命名、格式、启用、删除、保存、保存并启用、统计、文件信息等多个决策；
- “保存”和“保存并启用”并列，主操作不唯一；
- 未保存草稿与持久化文件的对象模型没有被界面解释；
- 空内容的 token/字节/行数是精确但无用的信息，增加旧式工具感。

#### 候选任务模型

把预设工作流拆成状态，而不是把所有动作永久展示：

```text
no-selection
  -> new-draft
  -> dirty-draft
  -> saved-inactive
  -> saved-active
  -> save-failed / activation-failed
```

每个状态只暴露当前必要动作：

- `new-draft`：命名、编辑、保存；
- `dirty-draft`：保存为主操作，离开时处理未保存；
- `saved-inactive`：编辑、启用；
- `saved-active`：编辑、停用或切换当前；
- 删除、导入、复制路径等低频/危险动作进入上下文菜单或次级区域；
- “保存并启用”是否保留，应根据真实高频流程决定，不应仅因为后端支持两个命令就永久并列。

#### 布局候选（需要用户确认）

**候选 A：继续使用大 Dialog，但降低工具感**

- 保留左侧列表和中央编辑；
- 右侧检查器默认收起或仅在有诊断/有意义元数据时出现；
- 顶部只保留对象身份、脏状态和一个主动作；
- 优点：改动小，维持当前入口；
- 风险：大 Dialog 仍可能与主应用形成“应用套应用”。

**候选 B：预设成为独立工作区/设置子页**

- 用真实页面级布局承载三栏或两栏；
- Dialog 只负责快速选择/确认；
- 优点：复杂度与容器层级一致，键盘与响应式更容易；
- 风险：涉及导航与返回路径，范围更大。

本文不替用户决定 A/B。Agent 可以给出基于使用频率、导航成本和实现风险的推荐，但不能偷偷选择。

#### 信息减法建议

- 空编辑器时隐藏 token/字符/行数/字节网格；
- 内容存在且统计确有价值时，压缩为一行次要元数据；
- 文件格式如果创建后很少改变，应在创建步骤确定，而不是永久占据工具条；
- 稳定状态优先使用普通文字，不为“未启用”永久绘制带图标胶囊；
- 边框用于编辑器、列表选择和真正的分区，不让每一层都拥有完整边框。

#### 验收标准

- 用户首次新建时，视觉上只有一个明确主动作；
- “0 个已保存文件 + 1 个未保存草稿”有明确解释；
- 删除不与保存并列成为同等级动作；
- 空内容时无意义统计不占据主要视觉空间；
- 小尺寸下不靠把三栏强行压窄解决；
- 键盘焦点顺序与任务顺序一致。

### F-06：图标不是单纯“旧”，而是缺乏统一光学语法

**优先级：P2**

**证据：E1 + E2 + E3**

#### 观察

当前大量使用 Lucide，本身不是必须替换的理由。更明显的问题是：

- 12–14px 的细线图标过多，在暖白低对比界面中显得虚弱；
- 导航、品牌、状态、行内动作和危险动作常以相近尺寸/线宽出现；
- 很多文字动作也附带图标，图标不再是稀缺信号；
- 品牌 SVG、Lucide 线性图标、圆形状态点和胶囊图标缺少共同的光学尺寸规则；
- 图标外壳有圆形、圆角矩形、裸图标等多套做法，但语义边界不稳定。

代码例：

- `Frontend/src/shared/ui/ModelProviderIcon.tsx` 默认品牌图标约 16px；
- 会话、预设、工具条和状态组件中存在大量 `h-3.5 w-3.5`、`h-4 w-4` 直接指定；
- 多个功能文件直接从 `lucide-react` 导入，缺乏集中尺寸或角色约束。

#### 改良方向

先定义“何时使用图标”和光学角色，再考虑是否替换具体 glyph：

| 角色      |     候选尺寸 | 使用规则                                          |
| --------- | -----------: | ------------------------------------------------- |
| 主导航    |         16px | 与稳定标签配对，选中靠容器/文字层级，不靠彩色图标 |
| 主要操作  |         18px | 仅在图标显著提高识别时使用；文字命令可无图标      |
| 状态      |      16–20px | 必须和状态文字/结构共同表达，不单靠颜色           |
| 辅助操作  |  不低于 14px | close、chevron、more 等约定俗成图标               |
| 品牌/模型 | 单独光学校准 | 不强迫所有 logo 塞入同一个几何盒                  |

同时定义 icon-only 资格：

- 用户能通过平台约定稳定识别；
- 有 `aria-label`；
- 非显而易见动作有 Tooltip；
- 触控/点击目标满足要求，glyph 大小不等于命中区大小。

#### 验收标准

- 同一工具条中没有无意义的“每个按钮一个图标”；
- 图标角色、glyph 大小和命中区分离；
- 品牌图标在同一行视觉重量接近；
- 更换图标库不作为本阶段完成条件。

### F-07：Ladle Story 更像组件展柜，尚未充分承担产品回归契约

**优先级：P2**

**证据：E2 + E3**

#### 代码锚点

- `Frontend/src/design-system/tokens/ColorPalette.stories.tsx`
- `Frontend/src/design-system/tokens/TypographyScale.stories.tsx`
- `Frontend/src/shared/ui/Skeleton.stories.tsx`
- `Frontend/src/shared/ui/StateView.stories.tsx`
- `Frontend/src/shared/ui/ErrorBoundary.stories.tsx`

#### 问题信号

- 大量“圆角边框卡片 + p-4 + token/属性说明”的展示结构会强化 Story 自身的模板感；
- Skeleton Story 展示形状和假消息，但没有首先验证 loading → content 的空间稳定性；
- StateView Story 主要把 loading/error/empty 放进固定高度边框框体，容易验证“组件长什么样”，但不足以验证“在真实上下文是否正确”；
- ColorPalette 能说明色值，但不能证明 active/warning/danger 在真实同屏中可区分；
- Story 若复制业务外壳或发明生产不存在的 variant，会产生第二事实来源。

#### 改良方向

Story 的首要任务从 showcase 转为 contract：

1. 直接导入生产组件，不复制样式；
2. 以真实上下文命名：字段错误、列表空态、面板失败、会话运行失败、应用致命错误；
3. 覆盖短/长中文、英文技术字段、超长 URL、空 detail；
4. 覆盖 light/dark、accent 变化和状态同屏；
5. 覆盖 390/900/1280/1440/1600 项目预设；
6. 覆盖 keyboard focus、disabled/busy、reduced/none motion；
7. 对 skeleton/state 重点检查状态转换前后的布局，而不是只截图单个静态状态。

建议最小状态矩阵：

| 场景             | 必须覆盖                                                   |
| ---------------- | ---------------------------------------------------------- |
| InlineError      | 单行、折行、重试、读屏通知                                 |
| Panel StateView  | loading、empty、recoverable error、无 CTA                  |
| Chat run failure | 404 模型端点、超时、未知错误、展开详情、重试中             |
| History recovery | 快速成功、慢恢复、失败、保留内容、空历史                   |
| Preset           | 无文件、未保存草稿、脏草稿、已保存未启用、已启用、保存失败 |
| Fatal boundary   | 开发详情/生产详情边界、恢复动作                            |
| Semantic colors  | active/running/warning/danger/success 同屏，浅色/深色      |

#### 验收标准

- Story 文件不维护平行组件实现；
- 新的状态语义在 Story 和测试中同时有契约；
- 不增加“候选 A/B”生产 Story；候选设计应放在临时可视化中，确认后只保留最终方案；
- `check.ladle` 和 `ladle:build` 通过。

## 7. 建议的设计系统契约

### 7.1 颜色角色

```text
surface: canvas / sidebar / panel / raised / subtle / muted
content: strong / primary / secondary / muted / disabled
accent: content / surface / border / solid / focus
status: success / warning / danger / info
```

原则：surface 负责空间，content 负责层级，accent 负责交互，status 负责结果。不要让同一个 token 同时扮演多个系统。

### 7.2 边框、圆角与阴影

- 先减少嵌套容器，再讨论圆角数值；
- 页面/工作区不包成额外大卡片；
- 列表行通过选择面与间距区分，不要求每行独立卡片；
- 边框用于输入、编辑器、分区和可点击边界；
- 阴影只解释层级变化，例如浮层，不用于让普通容器“更高级”；
- 头像、开关、进度条和聊天气泡可保留功能性几何例外。

### 7.3 字体与等宽字

- 普通标题、说明、导航、状态使用 UI 字体；
- 等宽字只用于代码、路径、URL、ID、模型标识、快捷键和确需对齐的数值；
- 技术详情折叠后可以等宽，但错误的人类摘要不使用 terminal 语气；
- 类型层级由字号、字重、行高和间距共同产生，不靠给每个小标题加色块或卡片。

### 7.4 状态组件边界

```text
InlineError       -> field / row
StateView         -> bounded panel / list
ChatRunFailure    -> conversation run
RecoveryIndicator -> history/session continuity
ErrorBoundary     -> fatal render failure
Toast             -> transient cross-surface feedback
```

Agent Review 时应优先检查调用场景是否选错组件，而不是先调组件 CSS。

### 7.5 动效契约

结构与状态语义确认后再做动效：

- 使用 `emil-design-eng` 判断动效是否增加反馈或连续性；
- 复用 `Frontend/src/shared/motion`、`AppMotionProvider`、`useMotionLevel`、现有 timing/spring/variants；
- `transitions-dev` 只能作为明确请求时的 CSS recipe 参考，不作为第二套动效权威；
- 优先：错误详情展开、恢复状态切换、Dialog/面板存在性、icon swap；
- 拒绝：实时消息逐条大幅入场、持续发光、为静态空状态加漂浮装饰、用 shimmer 掩盖未知布局。

## 8. 实施阶段建议

每个 Phase 都应形成独立、可回滚、可视觉 Review 的 diff。后续 Agent 可以进一步拆分，但不应把所有 Phase 合并成一次“全面美化”。

### Phase 0：复现与状态清单

**目的**：在改样式前确认真实状态来源和协议边界。

任务：

- 复现截图 A 的 404 模型失败；
- 确认 system message 是否只有错误，是否有结构化 error payload；
- 复现会话历史恢复的快速/慢速/失败路径；
- 复现“0 文件但存在草稿”的预设状态；
- 列出 active/running/warning/danger/success 当前调用点；
- 截取 390、900、1440、1600 基线。

交付：状态清单、复现步骤、截图和协议说明。Phase 0 不做视觉实现。

### Phase 1：语义状态 token 与状态矩阵

**目的**：先解决颜色职责，不先改每个页面。

候选写集：

- `Frontend/src/shared/theme/**`
- `Frontend/tailwind.config.js`
- 对应 token/状态 Story
- 对应主题与可访问性测试

任务：

- 建立 status semantic aliases；
- 选取少量关键组件迁移验证；
- 同屏 Story 比较 accent 与各状态；
- 验证 light/dark 和不同 accent。

禁止：全局机械替换 `brick`/`umber`；在没有映射清单时修改代码语法色。

### Phase 2：会话失败与恢复连续性

**目的**：让失败可恢复，让 loading 不伪造内容。

候选写集：

- `Frontend/src/features/chat/SystemMessageRow.tsx`
- 新的会话失败组件（文件名待确认）
- `Frontend/src/features/chat/HistoryRecoveryState.tsx`
- `Frontend/src/app/useSessionHistoryRecovery.ts`
- 相关 i18n、Story 与测试

任务：

- 建立错误摘要/动作/详情层级；
- 明确结构化错误适配；
- 替换假对话 skeleton；
- 保持滚动锚点与现有内容；
- 处理快速恢复不闪屏。

注意：上述多个文件在 2026-07-29 的工作区已经有未提交改动，必须先确认归属和意图。

### Phase 3：预设工作台信息架构

**目的**：先确定任务模型，再收缩视觉密度。

候选写集：

- `Frontend/src/features/chat/PresetPanel.tsx`
- `Frontend/src/features/chat/PresetWorkspace.tsx`
- `Frontend/src/features/chat/PresetSidebar.tsx`
- 相关状态逻辑、i18n、Story 与测试

前置决策：候选 A（大 Dialog 精简）还是候选 B（独立工作区）。

任务：

- 明确 draft/persisted/active 状态机；
- 每个状态只保留必要动作；
- 收起或按需显示检查器；
- 移除空内容无意义指标；
- 处理离开脏草稿、保存失败、启用失败。

禁止：只改圆角/阴影而不改变工具条优先级；用更多图标替代信息架构。

### Phase 4：图标语法与低频清理

**目的**：统一视觉重量，先减法后换 glyph。

任务：

- 建立角色/尺寸/命中区清单；
- 删除不增加识别度的文字按钮图标；
- 校准模型/品牌 logo；
- 统一 status/nav/action 的使用边界；
- Review 后再决定是否需要替换少量具体图标。

禁止：全库换图标包；为统一而把品牌图标强行改成线性通用图标。

### Phase 5：Story 契约与最终动效抛光

**目的**：把已确认的生产语言固定为回归契约。

任务：

- Story 从展柜改为真实状态矩阵；
- 补状态转换与布局稳定验证；
- 在结构稳定后增加少量反馈/连续性动效；
- 复查 reduced/none；
- 最终运行扫描器，记录新增/保留信号理由。

## 9. 当前工作区冲突边界

2026-07-29 观察到当前分支不是干净工作区。以下是当时已存在的改动，不能假定属于本草案，也不能被接手 Agent 覆盖：

### Desktop / Build

- `Apps/Desktop/RunDesktop.ts`
- `Apps/Desktop/RunDesktopLive.ts`
- `Build/DesktopNativeModuleMaintenance.ts`
- `Build/PrepareElectronNativeModules.ts`

### App / authentication / recovery

- `Frontend/src/App.tsx`
- `Frontend/src/app/ServerAuthenticationGate.tsx`
- `Frontend/src/app/useServerAuthentication.ts`
- `Frontend/src/app/useSessionHistoryRecovery.ts`
- `Frontend/src/app/useSocketErrorToasts.ts`

### Chat / shared UI / i18n

- `Frontend/src/features/chat/ChatComposer.tsx`
- `Frontend/src/features/chat/HistoryRecoveryState.tsx`
- `Frontend/src/features/chat/useComposerAttachments.ts`
- `Frontend/src/i18n/messages/en-US.json`
- `Frontend/src/i18n/messages/zh-CN.json`
- `Frontend/src/shared/ui/ErrorBoundary.tsx`
- `Frontend/src/shared/ui/StateView.stories.tsx`
- `Frontend/src/shared/ui/StateView.tsx`
- 删除：`Frontend/src/shared/ui/installCopyableToasts.ts`
- 新增：`Frontend/src/shared/ui/notifyError.ts`

### Tests / governance

- `Scripts/BackendTests/Core/DesktopNativeModuleMaintenanceBehavior.test.ts`
- `Scripts/FrontendTests/App/HooksIntegration.test.mjs`
- `Scripts/FrontendTests/App/ServerAuthenticationGate.test.mjs`
- `Scripts/FrontendTests/App/ServerAuthenticationHook.test.mjs`
- `Scripts/FrontendTests/App/SessionHistoryRecovery.test.mjs`
- `Scripts/FrontendTests/Feature/ChatComposerAttachments.test.mjs`
- `Scripts/FrontendTests/Feature/ErrorBoundary.test.mjs`
- `Scripts/FrontendTests/Feature/ToastActions.test.mjs`
- 新增：`Scripts/FrontendTests/Feature/StateView.test.mjs`
- `Scripts/VerifyWorkspaceDependencyGovernance.ts`

接手 Agent 必须实时重跑 `git status`。以上只是快照，不是当前事实的永久保证。

## 10. 验证策略

### 10.1 静态与组件契约

涉及公共组件、主题或 Ladle 时至少执行：

```powershell
npm --workspace senera-frontend run check.ladle
npm --workspace senera-frontend run check.types
npm --workspace senera-frontend run ladle:build
```

根据改动范围补充：

```powershell
npm --workspace senera-frontend run test
npm --workspace senera-frontend run build
```

不要引用旧会话里的构建结果作为当前通过证据；每次都要实时运行并原样记录 blocker。

### 10.2 视觉尺寸

按仓库规则至少检查：

- 390px：移动窄屏；
- 900px：中间布局；
- 1280px：紧凑桌面；
- 1440px：主桌面；
- 1600px：宽屏工作区。

关键观察：

- 会话错误是否与触发消息和 composer 保持空间关系；
- 展开技术详情是否挤压/覆盖主要动作；
- 恢复前后滚动锚点是否变化；
- 预设工具条是否换行或制造横向滚动；
- 三栏/两栏在中等宽度是否有明确降级策略；
- 深浅主题、不同 accent 下状态是否仍可辨识。

### 10.3 无障碍

- 错误通知的 `role` / `aria-live` 不重复播报；
- 技术详情展开控件有状态语义；
- icon-only 动作都有可访问名称；
- Tooltip 不替代可访问名称；
- focus 顺序与任务顺序一致；
- 状态不只靠颜色；
- reduced/none motion 不丢失内容或反馈。

### 10.4 扫描器

实现后可以重跑：

```powershell
node C:\Users\Administrator\.agents\skills\kill-ai-slop\scripts\scan.mjs Frontend/src
```

报告方式：

- 记录命中变化；
- 说明人工确认的新增/移除；
- 对有功能意义的圆形、pulse、等宽字和三栏结构写保留理由；
- 不把命中数变小当成视觉 QA 通过。

## 11. 需要用户确认的产品决策

以下不应由实现 Agent 擅自决定：

1. **危险色方向**：保持暖色家族但拉开色相，还是允许更明确的红色进入 Senera；
2. **预设容器**：精简大 Dialog，还是升级为独立工作区；
3. **聊天失败主动作**：不同错误类型下，重试、切模型、打开设置谁是主动作；
4. **技术详情默认级别**：默认折叠到什么程度，是否始终提供一键复制；
5. **聊天空状态语气**：偏任务模板、偏当前上下文，还是极简无建议；
6. **图标治理范围**：只建立规则并修关键路径，还是安排后续全产品渐进迁移。

Agent 可以推荐，但应明确依据、收益和代价，并等待确认。

## 12. Review 清单

Reviewer 可以按以下格式逐条给结论：

```text
[同意 / 部分同意 / 反对] F-0X 标题
- 证据是否足够：
- 根因是否成立：
- 建议方案的副作用：
- 更小的替代方案：
- 必须补充的测试/Story：
- 是否需要用户决策：
```

全局 Review 至少回答：

- 是否确实存在三种视觉方言，还是本文过度概括；
- status semantic tokens 是否是最小正确抽象；
- 会话错误是否应该独立于 `InlineError` / `StateView`；
- 当前错误协议是否支持结构化呈现；
- skeleton 策略是否能在不增加感知等待的情况下保持连续性；
- 预设问题主要是布局、状态模型还是入口层级；
- 哪些图标问题可通过减法解决，哪些确实需要换 glyph；
- Story 改造是否覆盖真实产品状态而没有创建第二实现；
- 每个 Phase 是否有过宽写集或隐含业务重构。

## 13. 可直接复制给另一个 Agent 的上下文

```text
请 Review `docs/Development/FrontendVisualCoherenceRedesignDraft.md`。

工作区：D:/AI/sentra-agent-v2/senera
目标：审查 Senera 当前主题/状态/错误/加载/预设工作台/图标/Story 的视觉一致性方案，不要直接实施。

要求：
1. 先读 Frontend/AGENTS.md、FrontendMotionPolicy.md、FrontendLadleConstraints.md 和旧 frontend-kill-slop-audit.md。
2. 先运行 git status --short --branch，尊重现有未提交改动。
3. 对草案 F-01 至 F-07 分别判断证据、根因、方案、副作用、最小替代方案、测试和是否需用户决策。
4. 不把 kill-ai-slop 扫描命中当作 bug 数；要区分产品代码、Story、技术等宽字和功能性几何。
5. 特别反证以下主张：
   - accent 与 danger/warning 发生语义碰撞；
   - system message 不应统一走 InlineError；
   - HistoryRecoveryState 的假对话 skeleton 会制造错位；
   - 预设工作台的首要问题是任务层级而非单纯样式；
   - 图标问题应先通过语法与减法解决，而不是换库。
6. 输出按优先级排序的 Review finding；每条给准确文件/组件位置。若没有反对意见，也要写出残余风险和待确认决策。
7. 不修改文件、不创建计划目录、不提交、不推送，除非用户随后明确授权。
```

## 14. 本草案建议的第一步

不要立即从“全局换警告色”或“重做预设页”开始。最稳妥的下一步是：

1. 让一个独立 Agent 按第 13 节做反证式 Review；
2. 人工确认 F-01/F-02 的状态语义与错误协议边界；
3. 用户先决定预设候选 A/B；
4. 再把 Phase 1 或 Phase 2 拆成一个窄范围实施任务。

这样可以避免再次出现“扫描器发现很多 slop，所以直接全局清理”的失真，也能避免把当前正在进行的错误/恢复 WIP 覆盖掉。
