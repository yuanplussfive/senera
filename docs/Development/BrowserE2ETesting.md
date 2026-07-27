# 浏览器 E2E 测试

浏览器 E2E 使用 Playwright 管理的 Chromium，从 HTTP、Cookie、WebSocket 和 DOM 外部验证生产构建。测试只替换外部模型供应商，Senera 前端、认证、服务端、Agent Runtime、BAML 和 Pi 流程均使用真实实现。

同一套运行时 harness 通过 `authenticationMode: "disabled" | "required"` 覆盖无鉴权和管理员鉴权两种部署。Electron 项目使用真实 preload bridge 验证独立桌面设置窗口，和 Linux 上的 Chromium 任务分开执行。

## 本地运行

首次运行先安装 Chromium：

```bash
npm run test.e2e.web.setup
```

完整构建并执行浏览器 E2E：

```bash
npm run test.e2e.web
```

已有最新构建时可以只执行：

```bash
npm run test.e2e.web.run
```

Windows 上执行桌面设置页 E2E：

```bash
npm run test.e2e.desktop
```

已有最新构建时可以只执行：

```bash
npm run test.e2e.desktop.run
```

测试使用动态回环端口和临时工作区，不需要手动启动开发服务器。失败时结果和 trace 位于 `.cache/playwright-results`，HTML 报告位于 `.cache/playwright-report`。

## 边界

- Browser E2E 不得导入 `Frontend/src`、读取 Zustand store 或伪造运行时事件。
- Browser E2E 不得设置 `window.__SENERA_RUNTIME_CONFIG__`；必须读取服务实际返回的配置。
- 不使用固定等待时间。交互和断言依赖 Playwright locator 与自动等待。
- 真实焦点、Tab 焦点陷阱、关闭后的焦点恢复、Portal DOM 归属、原生键盘/指针事件链和浏览器导航只由 Playwright 断言。
- Vitest/jsdom 保留纯函数、状态投影、Hook 回调、数据筛选和不依赖浏览器布局的可访问属性测试；不得用它替代浏览器焦点或 Portal 行为。
- 业务动作可以分层覆盖：Vitest 验证发送参数和失败分支，Playwright 验证用户从菜单、Dialog 或快捷键完成动作的真实路径。
- Linux PR 任务只运行 Chromium；真实 Electron 设置页由 Windows 平台任务执行，不向 Web 项目加入额外浏览器引擎。
- 协议并发、取消、审批和运行时阶段行为继续由 `Scripts/IntegrationTests` 中的 Vitest 集成测试覆盖。
