# 前端动效策略

动效用于解释状态变化和空间关系，不承担业务时序。产品设置中的 `full`、`reduced` 和 `none` 是统一契约，新增交互必须同时支持三档。

## 技术边界

- 简单的 hover、focus、颜色和菜单反馈使用 CSS；进入、退出、列表增删和布局变化使用共享 Motion 组件。
- Motion 参数集中在 `Frontend/src/shared/motion/presets.ts`。业务组件使用共享 preset 或组件，不自行复制 duration、spring、位移和 stagger。
- Radix 菜单使用其 `--radix-*-content-transform-origin` 变量，不读取视口后手工计算原点。
- overlay、panel 和业务内容各自只有一个动画所有者。关闭中的 overlay 必须禁用指针事件，但需要保留的内容应由动画完成回调卸载，不使用业务层定时器猜测退出时长。
- 动效不能决定请求、保存、导航或状态提交是否发生；动画中断不得改变业务结果。

## 列表 hover 与选中所有权

同一块像素只能有一个动画所有者。指针跟随高亮和选中指示器落在同一行时按下列规则拆分：

- 指针跟随高亮由 `FluidHoverHighlight` 独占，每个列表只有一个图层。它按 hover session 重新挂载，不使用 presence 退出动画（退出窗口内的两个子节点会在同一批行上叠加两层底色）；离开列表时直接卸载。
- 选中指示器由业务行自己的 `layoutId` 拥有；会话列表保留选中底色的跨行迁移动画，但不通过字体加粗或缩放重复表达选中。选中行已经画出自己的表面时，该行的 `FluidHoverHighlight` 必须通过 `hidden` 让位。
- `FluidHoverHighlight` 的尺寸由测量结果即时设置，只动画 `x`、`y` 和透明度；不得直接动画 `width`、`height`，避免 hover 与点击后的布局重排争用主线程。
- 列表进入/退出由 `MotionList` / `MotionListItem` 拥有。接入指针跟随高亮的列表不要在进入/退出时位移条目，否则缓存 rect 与真实位置错位。
- 重新测量只负责重定向，不负责卸载。窗口 resize、`ResizeObserver` 和条目重新注册都必须保留已经挂载的高亮图层，否则每次重排都会闪一次。
- `reduced` 下高亮只保留短暂透明度反馈；`none` 下位置与透明度都即时切换。

高亮图层的 `x`、`y` 使用列表容器 padding 边原点坐标，与 `offsetTop` / `offsetLeft` 一致。因此业务行必须相对列表容器定位（`relative`），列表容器自身不要加 `transform`。

## 三档行为

| 等级      | 行为                                                           |
| --------- | -------------------------------------------------------------- |
| `full`    | 可使用短距离位移、缩放、透明度和布局动画，表达方向与层级。     |
| `reduced` | 保留短暂透明度反馈，移除非必要位移、缩放和布局移动。           |
| `none`    | 状态即时切换；不得残留 stagger、过渡延迟或阻塞交互的退出窗口。 |

系统级 `prefers-reduced-motion` 优先于产品中的 `full` 设置。测试或嵌入环境的强制禁用优先级最高。

## Loading 约定

- 页面或面板结构等待数据时使用 `Skeleton`；骨架只负责保留布局，不叠加额外的波形或轨迹动画。
- 短时动作（保存、刷新、提交、重试）使用共享 `Button loading`、`IconButton loading` 或 `Spinner`，保持控件尺寸不变并设置 `aria-busy`。
- 面板/列表的完整状态使用 `StateView`；所有 `Suspense` fallback 必须有可见内容、`role="status"` 和可理解的文案。
- 后台刷新不得用全屏遮罩阻塞已有内容；真正的 modal loading 必须设置 `aria-modal`，并隔离背景焦点。
- 通用 loading 动画只通过 `.senera-spinner`、`.senera-loading-pulse` 和 `.shimmer`；`reduced`/`none` 下全部停止，状态仍由文案或静态图标表达。

## 评审清单

1. 动效是否解释了状态或空间关系，而不是纯装饰。
2. 是否复用了 `Frontend/src/shared/motion` 与 `Frontend/src/styles/transitions.css` 的现有能力。
3. 是否覆盖完整、减少和关闭三档，并且关闭态不截获指针事件。
4. presence 内容是否通过动画生命周期管理，而非重复硬编码毫秒数。
5. 菜单是否在视口边缘保持正确原点，动态列表是否避免大量元素 stagger。
6. 是否在窄屏、宽屏、浅色和深色主题下检查内容溢出与焦点可见性。
