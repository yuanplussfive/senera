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

测试使用动态回环端口和临时工作区，不需要手动启动开发服务器。失败时结果和 trace 位于 `.cache/playwright-results`。HTML 报告只在 CI 环境生成到 `.cache/playwright-report`；本地运行使用 list reporter，需要报告时显式追加 `--reporter=html`。

## CI 执行范围

Verify 先构建一次后端和前端，再把同一份构建交给静态门禁、Chromium 和 Windows Electron。构建已经完成前后端类型检查，后续任务只运行尚未覆盖的治理和行为检查。前后端单元测试由 coverage 任务各运行一次，集成测试单独运行一次。

Product Release 的正常发版使用主分支 Verify 的成功结果，不再执行浏览器 E2E。指定 `recovery_sha` 恢复发版时，先校验提交来源，再调用同一个 Verify 工作流，所有检查通过后才允许恢复标签；不会维护另一套发版测试步骤。打包后的容器运行检查验证实际发布物，继续单独执行。

Product Release 只监听主分支上的 Verify 完成事件，普通功能分支 PR 验证结束时不会再生成整套跳过的发版任务。PR 标题编辑仍会触发 Verify，因为同一个 `edited` 事件也包含目标分支变更；不能直接跳过全部重任务，让未验证的新合并上下文显示通过。

普通 PR 和主分支提交按提交范围检查格式；手动运行 Verify、首次推送等没有明确范围的执行会检查全仓，避免在干净检出中只检查空的工作区差异。供其他工作流调用的 `full_suite` 可显式要求全仓格式检查；其他任务本来就会完整运行。工作流不会在结束后再次调用本地测试包装脚本。`npm run verify.all` 由明确的契约套件组成，不执行依赖外部桌面、容器或发布凭据的探针，也不重复调用 Vitest。

ESLint 缓存按平台、锁文件和源提交保存，后续提交恢复相同依赖下最近一次缓存，再由内容哈希判断哪些文件需要重查。缓存命中不会跳过 Lint。

Security Scan 中的 Trivy 只扫描一次，保存 JSON 结果，再用 `trivy convert` 生成完整严重级别的 SARIF 和 HIGH、CRITICAL 门禁。报告转换不重新扫描仓库，也不会因为合并扫描而扩大门禁的严重级别范围。

同一 PR 或分支的新 Security Scan 会取消过时扫描，避免连续推送积压多套 CodeQL 和 Trivy。Trivy 扫描失败仍然使任务失败；只有实际生成 SARIF 后才上传，避免额外报一个文件不存在的错误。

查看套件将要执行的去重脚本列表：

```bash
npm run verify.suite -- all-local --list-scripts
```

## 用例归属

- 设置页深链接、打开关闭和分区导航归 `SeneraSettingsJourney`。
- 分块加载失败、自动恢复和慢加载归 `SeneraWorkspaceJourney`。
- 会话创建、切换、重命名、删除和恢复归 `SeneraSessionJourney`。
- `SeneraWebJourney` 保留部署认证、完整个人资料焦点链、供应商切换和功能坞交互，不复制上述基础路径。
- 同一路径的桌面与移动布局可以分别检查。多个宽度应优先验证几何和可访问性；没有不同业务分支时，不为每个宽度重复整套上传、认证和发送流程。
- 工作区选择器与文件预览按浅色、深色分别建立页面，再用 `test.step` 检查五种宽度；每种宽度仍保留截图，不为尺寸变化重启完整服务。

新增用例前先检查所属文件。同一故障的完整交互链保留在一处，纯参数、数据投影和回调分支由 Vitest 覆盖。

独立用例使用 Playwright 默认执行模式。单 worker 已保证顺序执行，不再设置 `mode: "serial"`；串行测试组会在一次失败后跳过其他用例，并在重试时连同已经通过的用例一起重跑。每条用例应自行建立需要的状态，让 CI 只重试失败的那一条。

## 边界

- Browser E2E 不得导入 `Frontend/src`、读取 Zustand store 或伪造运行时事件。
- Browser E2E 不得设置 `window.__SENERA_RUNTIME_CONFIG__`；必须读取服务实际返回的配置。
- 不使用固定等待时间。交互和断言依赖 Playwright locator 与自动等待。
- 真实焦点、Tab 焦点陷阱、关闭后的焦点恢复、Portal DOM 归属、原生键盘/指针事件链和浏览器导航只由 Playwright 断言。
- Vitest/jsdom 保留纯函数、状态投影、Hook 回调、数据筛选和不依赖浏览器布局的可访问属性测试；不得用它替代浏览器焦点或 Portal 行为。
- jsdom 可以派发合成事件，验证事件处理器的回调参数、阻止默认行为或阻止冒泡，例如带模拟 xterm 的复制处理器。这不代表已经验证原生右键菜单、键盘焦点或浏览器剪贴板权限。
- 业务动作可以分层覆盖：Vitest 验证发送参数和失败分支，Playwright 验证用户从菜单、Dialog 或快捷键完成动作的真实路径。
- Linux PR 任务只运行 Chromium；真实 Electron 设置页由 Windows 平台任务执行，不向 Web 项目加入额外浏览器引擎。
- 协议并发、取消、审批和运行时阶段行为继续由 `Scripts/IntegrationTests` 中的 Vitest 集成测试覆盖。
