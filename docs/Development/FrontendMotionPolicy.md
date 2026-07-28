# 前端动效与设计 Skill 选型

本文定义 Senera 前端使用设计 Skills、动画实现技术和新增依赖时的最终决策边界。它负责回答：

- 哪个 Skill 可以提出建议，哪个 Skill 拥有最终实现权；
- 什么时候使用 CSS，什么时候使用 Motion；
- 哪些上游建议必须被 Senera 的现有架构覆盖；
- 什么时候允许引入专项交互库；
- 实现后必须经过哪些审查和验证。

本文的项目约束优先于第三方 Skill 中的通用建议。组件语义继续以 [`FrontendLadleConstraints.md`](./FrontendLadleConstraints.md) 为准，资源增长以 [`FrontendPerformanceBudgets.md`](./FrontendPerformanceBudgets.md) 为准。

## 1. 当前技术基线

Senera 是高频使用的桌面与 Web 工作台，不是营销页面。动效应帮助用户理解状态、空间关系和操作反馈，不承担装饰性展示职责。

当前基线为：

- React 18、Tailwind CSS 4；
- Radix primitives 和 `Frontend/src/shared/ui` 中的项目 wrappers；
- `framer-motion` 12，统一通过 `Frontend/src/shared/motion` 接入；
- `AppMotionProvider`、`useMotionLevel`、`motionTimings`、`motionSprings` 和 `read*Variants()`；
- `Frontend/src/styles/transitions.css` 中的共享 CSS transitions；
- Ladle 作为真实公共组件的状态与视觉回归入口。

不得因为第三方 Skill 偏好 Base UI、Motion 新包名、GSAP 或其他组件体系，就绕过现有 wrappers 或创建第二套 motion vocabulary。

## 2. Skill 决策权

| Skill                          | 职责                                                    | 使用方式                         | 决策权                                   |
| ------------------------------ | ------------------------------------------------------- | -------------------------------- | ---------------------------------------- |
| `emil-design-eng`              | 判断是否需要动效，设计并实现交互                        | 普通功能与动效改造的主 Skill     | 最终动效决策与实现                       |
| `review-animations`            | 审查本次改动中的 motion 代码                            | 实现后只读审查                   | 可阻断明显回归，但项目证据可推翻绝对规则 |
| `find-animation-opportunities` | 寻找值得增加动效的位置                                  | 系统扫描时只读使用               | 只产生候选，不直接实施                   |
| `prototype`                    | 比较多个都合理的交互方向                                | 仅在代码和约束无法决定时显式使用 | 用户选择后才可进入生产代码               |
| `apple-design`                 | 手势、拖拽、惯性、速度传递、rubber-band 和可打断 spring | 仅用于物理交互专项               | 只决定手势物理，不决定材质与排版         |
| `transitions-dev`              | 查询通用 CSS transition 配方                            | 被明确点名时使用                 | 仅提供参考，不拥有参数和 token 决策权    |
| `motion-framer`                | 查询 Motion API 和实现模式                              | API 不确定时按需使用             | 技术参考，不判断该不该动画               |
| `web-design-guidelines`        | 键盘、焦点、ARIA、滚动与通用交互审查                    | 动效审查之后使用                 | 无障碍和交互门禁                         |
| `kill-ai-slop`                 | 扫描模板化、装饰过度和无意义视觉模式                    | 页面或较大视觉改动时使用         | 候选需人工确认后再改                     |
| `design-taste-frontend`        | 页面级视觉方向和大范围重构                              | 仅用于明确的大改版               | 不覆盖组件语义与 motion policy           |
| `ui-ux-pro-max`                | 设计资料与模式检索                                      | 需要外部候选资料时按需使用       | 研究输入，不直接决定依赖或实现           |
| `theme-factory`                | 文档、演示等独立产物主题                                | 不用于 Senera 产品界面           | 无产品 UI 决策权                         |

`animation-vocabulary` 只帮助给效果命名，可以按需安装，但不提升实现质量。`improve-animations` 默认创建 `plans/`、调度执行 Agent 和 worktree，不符合当前项目的直接审查与实现流程，不作为 Senera 标准 Skill。

## 3. 上游 Skill 的项目级覆盖

### 3.1 `emil-design-eng`

保留本地 Radix 适配版本。Popover、Dropdown、Context Menu 等锚定表面必须使用对应的 Radix transform-origin 变量，不得被上游 Base UI 示例替换。

当通用规则与项目现有 token 冲突时：

1. 先判断项目 token 是否已经表达同一用途；
2. 复用项目 token；
3. 只有现有 vocabulary 无法表达真实需求时，才在共享层补充 token；
4. 不在业务组件中写新的 duration、easing 或 spring 常量。

### 3.2 `review-animations`

以下规则是高价值默认值，但不是脱离上下文的语法禁令：

- 优先 transform 与 opacity；
- 避免 `transition: all`；
- 进入动画通常使用强 ease-out；
- 高频和键盘操作通常不应等待动画；
- 必须处理 reduced motion；
- 动态、可快速反转的交互必须可打断。

允许有证据的例外，例如：

- Accordion 的高度变化无法仅靠 transform 正确表达布局；
- Radix presence 协调可能使用不产生视觉位移的 keyframes；
- 小型、隔离且没有布局依赖的 prototype picker 可以动画 width；
- 极短退出动画可以使用不同 easing，但必须通过实际 feel check。

审查报告必须区分确定性缺陷、需要性能测量的问题和需要视觉比较的手感问题。

### 3.3 `apple-design`

只允许将它用于：

- pointer capture、拖拽阈值与方向锁定；
- release velocity、momentum projection 与 velocity handoff；
- interruptible springs；
- Sheet、Drawer、carousel 等直接操控界面；
- rubber-band、边界阻尼和 reduced-motion 替代行为。

不得从该 Skill 引入：

- 新的玻璃模糊、半透明材质或 backdrop-filter；
- 负字距、viewport 驱动字号或新的排版体系；
- 与现有主题 token 冲突的颜色、阴影和材质；
- 只为了呈现 Apple 风格而存在的动画。

### 3.4 `prototype`

禁止在生产路由和 Ladle Story 中创建候选 A/B 方案。原型必须满足：

- 优先放在 Codex 临时可视化目录或仓库外临时目录；
- 使用真实 token、真实尺寸和产品形状的内容；
- 不安装新的动画库；
- 不导入到生产代码；
- 用户选择后，只将获选方案接入真实组件；
- 选择完成后删除临时原型，除非用户明确要求保留。

上游固定 picker 的玻璃材质只属于临时比较工具，不得进入 Senera 产品 UI。

### 3.5 `pick-ui-library`

该 Skill 只能用于候选查询，最终选择必须先检查 `Frontend/package.json` 和现有 wrappers。

项目覆盖规则：

- UI primitives 保留 Radix，不迁移到 Base UI；
- Toast 保留 Sonner；
- 长列表保留 React Virtuoso；
- 状态管理保留 Zustand；
- class 组合保留 clsx，variant API 保留 CVA；
- 代码高亮保留 Shiki；
- 主题切换保留现有 appearance runtime，不引入 `next-themes`；
- 没有明确功能需求时，不预装 cmdk、NumberFlow、dnd-kit、recharts 等候选库。

## 4. 动画实现技术

### 4.1 原生 CSS

以下情况优先使用 CSS transition：

- hover、focus、active 和 press feedback；
- color、background-color、border-color、opacity；
- 简单且预先确定的 transform；
- 图标切换、Tooltip、Menu surface 和轻量状态反馈；
- 浏览器繁忙时仍应保持独立合成的固定动画。

CSS 动效优先写入 `Frontend/src/styles/transitions.css` 或相应共享组件样式。必须枚举 transition properties，禁止 `transition: all`。业务组件不得复制通用 dropdown、modal 或 icon-swap 动画。

### 4.2 Motion 12

以下情况使用 Motion：

- `AnimatePresence` enter/exit；
- layout animation 和共享布局关系；
- 列表插入、删除和重排反馈；
- Dialog、Sheet、Panel 的协调状态；
- 动态高度或无法预先确定终点的过渡；
- spring、drag、swipe 和可打断手势；
- 多个状态需要统一编排的交互。

所有生产实现必须接入 `AppMotionProvider` 和共享 presets。新增 Motion 代码前先检查 `Frontend/src/shared/motion` 是否已有 wrapper 或 reader。

### 4.3 WAAPI

只有同时满足以下条件时才直接使用 Web Animations API：

- 需要命令式控制；
- 动画是预先确定的 CSS 属性变化；
- Motion 或 CSS transition 无法满足中断、时间线或性能要求；
- 已通过性能测量证明值得增加独立实现。

WAAPI 不是默认第三层 abstraction，不应为了绕过现有 Motion wrapper 而引入。

### 4.4 专项交互库

- 可访问的跨区域拖拽、键盘排序和复杂 drop semantics 可以评估 dnd-kit；
- 常规图表只有在出现真实图表需求后再选库；
- GSAP 仅适合复杂时间线、SVG choreography 或营销型滚动叙事，当前产品工作台不得引入；
- React Spring、AutoAnimate 等与 Motion 职责重叠的库不得引入。

新增依赖必须说明：现有 CSS/Motion 为什么不足、增加的预算、reduced-motion 行为、卸载路径和对应测试。

## 5. `framer-motion` 与 `motion/react`

项目当前统一使用 `framer-motion`，不得在同一代码库中混用 `framer-motion` 和 `motion/react` imports。

对外选型名称统一写作 **Motion 12**。迁移到官方当前推荐的 `motion` 包时，必须使用独立的机械化改动：

1. 一次性替换依赖和所有 imports；
2. 不混入动效参数、组件视觉或业务行为修改；
3. 运行完整前端类型、行为、Ladle 和构建验证；
4. 比较构建 manifest 与 bundle budgets；
5. 确认 Radix presence、MotionConfig 和 reduced-motion 行为不变。

该迁移是维护方向调整，不是功能开发的前置条件，也不能被描述为性能优化，除非构建数据证明有实际收益。

## 6. 标准工作流

### 普通功能

```text
读取现有组件、shared motion 和项目约束
-> emil-design-eng 判断并实现
-> review-animations 审查本次 motion diff
-> web-design-guidelines 审查交互与无障碍
-> 类型、Ladle、行为测试
```

### 优化已有交互

```text
描述用户操作、频率和当前体验问题
-> 必要时 find-animation-opportunities 只读扫描
-> emil-design-eng 复核候选
-> 多个方案都合理时才做仓库外 prototype
-> emil-design-eng 接入获选方案
-> review-animations
-> web-design-guidelines
-> 测试
```

### 拖拽、滑动与惯性

```text
apple-design 提供手势物理约束
-> emil-design-eng 结合产品频率和现有 spring 做最终设计
-> 使用 Motion 和现有 shared motion 实现
-> review-animations
-> reduced-motion、窄窗口和真实指针操作验证
```

## 7. 验收

正式前端改动至少运行：

```bash
npm --workspace senera-frontend run check.types
npm --workspace senera-frontend run check.governance
npm --workspace senera-frontend run check.ladle
npm --workspace senera-frontend run test.behavior
git diff --check
```

修改公共组件、主题 token 或全局 transitions 时还要运行：

```bash
npm --workspace senera-frontend run ladle:build
```

新增依赖、修改 motion 入口、调整共享 presets 或范围较大时运行：

```bash
npm --workspace senera-frontend run build
```

视觉验收必须覆盖项目 Ladle 预设宽度，并检查 full、reduced 和 none 三种 motion level。无法仅从代码判断的 easing、spring 或 crossfade 手感，应使用独立临时可视化比较，不把候选实现留在生产代码中。
