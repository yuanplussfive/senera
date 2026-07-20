# Frontend Agent 工作规则

在修改本目录前，先阅读 `../docs/Development/FrontendLadleConstraints.md`。这里的规则适用于人工和 Agent 修改。

## 公共组件与 Ladle

- `src/shared/ui` 的生产组件是唯一事实来源。Story 必须直接导入真实组件，禁止复制组件实现或在 Story 中维护另一套样式。
- 修改公共组件样式时，检查对应 Story 是否仍覆盖真实状态；样式会通过直接导入自动更新，不要把 CSS 再抄进 Story。
- 修改组件属性、状态、交互语义或无障碍契约时，必须在同一次改动中更新对应 Story。
- 新增并从 `src/shared/ui/index.ts` 导出的视觉模块时，必须同时新增同名 `.stories.tsx`，使用中文可见文案并覆盖关键真实状态。
- 纯逻辑模块不应为了通过检查创建假 Story。新增豁免时，必须同时更新 Ladle 规范和验证脚本并写明理由。
- `ChatComposer` 属于依赖上传、模型和预设运行时的业务组件，不要用空壳回调或假数据创建临时 Story；需要单独调整时先确定真实运行时边界。
- 修改主题 token、`src/index.css` 中的公共组件样式或 `.ladle` 配置时，必须运行 Ladle 构建并检查受影响 Story。

## 组件语义

- 值选择使用 `MenuSelect`；按钮触发的操作集合使用 `DropdownMenu`；对象右键操作使用 `ContextMenu`。
- 有文字的命令使用 `Button`；只有图标的命令使用 `IconButton`，并提供可访问名称，必要时提供 Tooltip。
- 布尔设置使用 `Switch`。开关本身只显示轨道和滑块，不重复显示“已启用 / 已关闭 / ON / OFF”，也不增加带边框的按钮外壳。
- 表单文本输入优先使用 `FormField`、`FormLabel`、`FormHint` 和 `Input`。
- 不新增候选 A/B Story。需要讨论候选设计时使用独立临时可视化，确认后只把最终生产方案留在 Ladle。

## 文案与视觉

- Ladle 中面向人的标题、说明、操作和状态文字使用中文。技术标识、组件属性、token 和快捷键可以保留英文。
- 视觉变化使用 Ladle 的 `390px`、`900px`、`1280px`、`1440px` 和 `1600px` 项目预设复核，不以当前浏览器窗口宽度代替尺寸检查。
- 使用真实主题 token；不新增玻璃模糊、彩色发光、渐变光斑、重复胶囊、无意义卡片或卡片套卡片。
- Story 只负责组织真实状态，不得伪造生产组件不存在的 variant。

## 必跑检查

涉及前端公共组件或 Ladle 时至少运行：

```bash
npm --workspace senera-frontend run check.ladle
npm --workspace senera-frontend run check.types
npm --workspace senera-frontend run ladle:build
```

提交前还需运行受影响测试；范围较大时运行 `npm --workspace senera-frontend run test` 和 `npm --workspace senera-frontend run build`。
