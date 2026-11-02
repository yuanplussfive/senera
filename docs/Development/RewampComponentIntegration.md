# Rewamp 组件源码接入

当前接入 Pill Expand Navbar，用于运行面板页签和对话顶部工具入口。

- 展示：https://rewampui.com/components/pill-expand-navbar
- 原始源码：https://github.com/palakonweb/Rewamp-UI/blob/main/src/components/ui/PillExpandNavbarShowcase.jsx
- 原始描述：https://github.com/palakonweb/Rewamp-UI/blob/main/registry/pill-expand-navbar.json
- 作者：Palak / palakonweb。
- 上游 README 明示允许直接复制组件源码到项目，由使用者维护；npm 安装器 `rewampui@0.1.1` 标注 MIT。组件仓库未提供单独根 LICENSE，不能把安装器的 MIT 声明扩展成整个仓库的许可证声明。
- 运行时依赖为 Framer Motion、React 和通用图标；项目已有这些能力，无需安装 CLI、增加运行时依赖或远程加载组件。

这是按上游 README 允许的源码适配接入，未运行写入式 CLI。Rewamp 原生 registry 不是 shadcn registry，未把不兼容的地址加入 shadcn 白名单。

生产组件只有 `Frontend/src/shared/ui/PillExpandNavbar.tsx` 一份。保留悬停展开、选中恢复、标签淡入和原有弹簧参数，去掉演示文案、示例页面导航和主题监听器；直接使用项目主题 token。按钮复用 Button，页签复用 Radix Tabs 的选择、关联面板和键盘语义，图标由 AppIcon 提供。减少动画设置取消宽度弹簧和按压缩放。

Story 直接导入生产组件，覆盖面板页签、操作入口、禁用项和长标签。
