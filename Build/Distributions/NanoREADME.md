# Senera Nano

这是从 Senera `{{sourceBranch}}` 自动生成的轻量源码开发分支，只保留本机开发模式所需的后端、前端、MCP packages、Skills 与运行时依赖。

## 开始使用

需要 Node.js 24、npm 10 或更高版本。

```bash
git clone --depth 1 --branch {{outputBranch}} --single-branch {{repositoryUrl}}.git senera
cd senera
npm ci
npm run dev
```

启动后访问 `http://127.0.0.1:5173`。后端默认监听 `ws://127.0.0.1:8787`。

## 分支规则

`{{outputBranch}}` 是只读生成分支，不接收直接提交或 Pull Request。它在 `{{sourceBranch}}` 完整验证通过后自动更新；源代码修改和贡献请基于 `{{sourceBranch}}`。

当前快照来源：[{{sourceCommitShort}}]({{repositoryUrl}}/commit/{{sourceCommit}})。精确来源也记录在 `SENERA_NANO.json`。

Nano 的本地开发入口使用受治理的宿主机执行；只有 Compose 镜像部署会启动独立的 Docker Worker 和版本化 OCI 沙箱运行时。
Nano 不包含 Electron 桌面打包、测试、覆盖率和发布流水线。
