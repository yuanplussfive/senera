# Senera Nano

这是从 Senera `main` 自动生成的轻量源码开发分支，只保留本机开发模式所需的后端、前端、MCP packages、Skills 与运行时依赖。

## 开始使用

需要 Node.js 22 和 npm 10 或更高版本。

```bash
git clone --depth 1 --branch nano --single-branch https://github.com/yuanplussfive/senera.git senera
cd senera
npm ci
npm run dev
```

启动后访问 `http://127.0.0.1:5173`。后端默认监听 `ws://127.0.0.1:8787`。

## 分支规则

`nano` 是只读生成分支，不接收直接提交或 Pull Request。它在 `main` 完整验证通过后自动更新；源代码修改和贡献请基于 `main`。

当前快照来源：[1a8c87524d1e](https://github.com/yuanplussfive/senera/commit/1a8c87524d1e2b94a6c6e4dddf23d239f45fa64c)。精确来源也记录在 `SENERA_NANO.json`。

Nano 开发入口固定使用 microsandbox，不启动 Docker Engine 或 gVisor Worker。Nano 不包含 Docker、Electron 桌面打包、测试、覆盖率、发布流水线和相关工具依赖。
经过完整性校验的版本化 OS Sandbox Bundle 已包含在分支中；首次准备沙箱不会再访问 GitHub Releases 或容器镜像仓库。
