# 前端 Ladle 组件约束

Ladle 是当前生产组件的可执行说明和回归入口，不是候选设计画板。它展示的组件、状态和主题必须来自 `Frontend/src` 的真实实现；真实组件发生变化后，Ladle 应立即反映变化。

## 1. 单一事实来源

- 生产组件是样式和交互的唯一事实来源。Story 必须直接导入真实组件，不能复制一份局部组件、轨道、菜单项或按钮样式。
- Ladle 继续使用 `Frontend/vite.config.ts`，并由 `Frontend/.ladle/components.tsx` 加载 `src/index.css` 和真实主题 token。
- Story 可以用普通布局组织演示内容，但不能发明生产组件不存在的视觉变体、候选 A/B 方案或装饰外壳。
- Ladle 内面向人的标题、说明、按钮和状态文字使用中文。组件名、属性名、颜色 token、快捷键和 Story 导出名等技术标识可以保留英文。

## 2. 修改与新增规则

修改 `Frontend/src/shared/ui` 中的公共组件时：

1. 样式修改会通过真实组件导入自动显示在对应 Story 中，禁止在 Story 里复制新样式。
2. 属性、状态、交互语义或可访问性契约变化时，同一次修改必须更新对应 Story。
3. 修改后至少运行 `npm --workspace senera-frontend run check.ladle` 和 `npm --workspace senera-frontend run ladle:build`。
4. 视觉变化需要使用 Ladle 内置预设检查 `390px`、`900px`、`1280px`、`1440px` 和 `1600px`；交互组件还要检查键盘操作、禁用态和内容溢出。

新增公共视觉组件时，必须在同一次修改中完成：

1. 在 `Frontend/src/shared/ui/index.ts` 导出真实组件。
2. 新增同名 `ComponentName.stories.tsx`。
3. Story 直接从 `./ComponentName` 导入真实组件，并使用中文示例文案。
4. 覆盖组件真实支持的关键状态，不为凑数量创造变体。

纯逻辑 Hook 或工具不需要视觉 Story。当前唯一明确豁免是 `useClipboardCopy`；新增豁免必须在本文件和 `Scripts/VerifyFrontendLadleContracts.ts` 中说明理由。

## 3. 当前公共组件职责

| 模块                | 真实职责                     | Story 应覆盖的重点                           |
| ------------------- | ---------------------------- | -------------------------------------------- |
| `Button`            | 有文字的明确命令             | 真实 variant、尺寸、禁用态、图标组合         |
| `IconButton`        | 只有图标的熟悉命令           | 尺寸、tone、Tooltip、禁用态                  |
| `Switch`            | 布尔值切换                   | 开启、关闭、禁用、键盘焦点；只显示轨道和滑块 |
| `MenuSelect`        | 从一组值中选择一个值         | 当前值、占位、禁用选项、空状态、前后内容     |
| `DropdownMenu`      | 由按钮打开的操作集合         | 图标、分组、快捷键、危险操作、只读信息       |
| `ContextMenu`       | 对当前对象执行的右键操作     | 触发区域、分组、快捷键、危险操作             |
| `Dialog`            | 需要确认或集中处理的模态任务 | 标题、说明、普通动作和危险动作               |
| `Sheet`             | 从侧边进入的辅助工作区       | 左右方向、关闭、表单组合                     |
| `Tooltip`           | 为图标或紧凑控件补充短说明   | 方位、快捷键、与图标按钮组合                 |
| `Form`              | 表单标签、提示和文本输入基线 | 必填、提示、禁用、无效状态                   |
| `FileDropZone`      | 文件拖放与文件选择交互       | 拖入、拒绝、单文件、多文件和校验             |
| `ScrollArea`        | 受控滚动区域                 | 纵向、横向和长内容                           |
| `ConversationFrame` | 对话区不同内容类型的宽度约束 | `prose`、`user`、`wide`、`composer`          |
| `ErrorBoundary`     | 捕获渲染错误并提供恢复入口   | 组件级、应用级和自定义 fallback              |
| `Logo`              | 品牌标记、字标和组合         | 尺寸、组合、主题适配                         |
| `MetaLabel`         | 紧凑的辅助标签与元数据标题   | 尺寸和真实使用位置                           |

## 4. 已确认的组件语义

### 菜单

- `MenuSelect` 只负责值选择。
- `DropdownMenu` 和 `ContextMenu` 负责操作集合；它们通过 `MenuShared.tsx` 共用菜单表面、菜单项、分隔线、图标和危险态样式。
- 菜单不能增加无意义标题、重复分隔线、装饰图标或仅用于显得复杂的选中标记。
- 供应商和模型图标属于真实数据时可以显示，必须由调用方明确传入。

### 开关

- `Switch` 只渲染轨道和滑块，不内置“已启用 / 已关闭”或 `ON / OFF`。
- 需要名称或说明时，由业务布局在开关外放普通文字，不能再包一层带边框的按钮外壳。
- 通用开启态使用主题强调色；绿色只表达成功、连接、健康或可用状态。
- `SwitchTrack` 只用于外层已经承担点击和无障碍语义的复合按钮，避免嵌套交互元素。

### 按钮、表单与焦点

- 有文字的命令使用 `Button`，纯图标命令使用 `IconButton`，不以手写按钮复制公共 variant。
- 表单文本输入优先组合 `FormField`、`FormLabel`、`FormHint` 和 `Input`。
- 组件保留各自真实的键盘焦点表现。`Switch` 当前使用 1px 细轮廓，不得恢复 2px 彩色光圈；其他组件的焦点规范若要统一，应先修改真实组件，再由 Story 自动反映。

## 5. 视觉边界

- 使用真实语义颜色和主题 token，不在 Story 中硬编码另一套品牌色。
- 不新增玻璃模糊、彩色发光、渐变光斑、重复胶囊、无意义卡片和卡片套卡片。
- 普通产品表面圆角保持在 6-10px；头像、开关、进度轨道和聊天气泡按自身几何语义处理。
- 动效只解释状态变化或空间关系，尊重减少动态效果设置，不为静态展示增加持续动画。
- Story 的演示布局不能遮挡内容；固定格式控件需要稳定尺寸，并检查窄屏换行和长文本。

## 6. 自动门禁

`npm --workspace senera-frontend run check.ladle` 会检查：

- Ladle 仍扫描 `Frontend/src/**/*.stories.{tsx,ts}`。
- Ladle 仍复用真实 Vite 配置、全局样式和主题 token。
- Ladle 保留 `390px`、`900px`、`1280px`、`1440px` 和 `1600px` 五档项目视觉复核宽度。
- `shared/ui/index.ts` 导出的每个公共视觉模块都有同名 Story。
- 每个公共组件 Story 都直接导入对应真实模块。
- 每个 Story 至少包含中文可见说明。
- Story 不重新出现开关旁的“已启用 / 已关闭 / ON / OFF”。

自动门禁只能验证结构，不能替代视觉判断。Story 是否覆盖了正确状态、布局是否失真、是否出现过度设计，仍需在 Ladle 中查看。

## 7. 业务组件边界

- `ChatComposer` 是依赖上传、模型和预设运行时状态的业务组件，不属于 `shared/ui` 公共组件目录，当前不要求为了通过门禁创建独立 Story。
- 修改 `ChatComposer` 的业务布局时，不得用空壳回调或假数据伪造“完整运行时”；应先确定真实运行时边界，再新增覆盖真实状态的 Story。
- 当前 `ConversationFrame` 的 `输入模式`、`Form` 和 `Sheet` Story 已覆盖 Composer 依赖的公共内容轴线、表单输入和面板组合。
