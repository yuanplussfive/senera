# 开发手册

新增能力时优先看对应手册：

- [新增工具开发手册](./AddTool.md)
- [新增运行时事件开发手册](./AddRuntimeEvent.md)
- [新增模型端点开发手册](./AddModelEndpoint.md)
- [Skill 生命周期与外部扩展边界](./ManagedExtensions.md)
- [学习系统边界与诊断](./Learning.md)
- [浏览器端到端测试](./BrowserE2ETesting.md)
- [桌面运行时审计](./DesktopRuntimeAudit.md)
- [前端设置工作台约束](./FrontendSettingsWorkbench.md)
- [前端组件 Registry 接入约束](./FrontendComponentRegistry.md)
- [前端 Ladle 组件约束](./FrontendLadleConstraints.md)
- [图标像素相位](./FrontendIconPixelPhase.md)
- [后续改进清单](./FollowUpBacklog.md)
- [前端动效策略](./FrontendMotionPolicy.md)
- [前端性能预算](./FrontendPerformanceBudgets.md)

如果改动会影响主循环、规划器、工具执行、记忆或前端事件投影，先读 [核心链路导览](../Architecture/CoreFlow.md)。

## 获取源码

贡献主干、运行测试或需要部署工具链时，克隆主仓库：

```bash
git clone https://github.com/yuanplussfive/senera.git senera
cd senera
npm ci
npm run dev
```

只需要在本机跑开发服务器时，可以克隆自动生成的 `nano` 分支：

```bash
git clone --depth 1 --branch nano --single-branch https://github.com/yuanplussfive/senera.git senera
cd senera
npm ci
npm run dev
```

`nano` 只保留开发服务器、前端、核心源码、MCP packages、Skills 和对应依赖，不包含 Compose 部署、Electron、安装包、测试、覆盖率和发布工具。它在 `main` 完整 Verify 通过后由 `Sync Nano` 工作流整体重建，不接收直接提交或 Pull Request；需要修改任何内容时使用主仓库。本地可以用 `npm run generate.nano` 重建同一份快照，`Scripts/VerifyNanoDistribution.ts` 会校验它的边界。

Nano 和桌面端一样使用受治理的本机执行边界，不启动 Docker Worker；只有 Compose 镜像部署会启用独立的沙箱 Worker，详见[部署与运维](../Operations.md#沙箱状态)。
