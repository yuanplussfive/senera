# 参与开发

感谢你愿意花时间看这个项目。这份文档讲清楚两件事：怎么把开发环境跑起来，以及提交代码前后你需要做什么、不需要做什么。规则不多，但都是硬的——CI 会逐条兑现。

## 起步

需要 Node.js 22+。克隆后在根目录装一次依赖就够了（仓库用 npm workspaces）：

```bash
npm ci
cp senera.config.example.json senera.config.json   # Windows 用 copy
npm run sandbox.archive
npm run dev
```

编辑 `senera.config.json` 填上模型服务的 `BaseUrl`、`ApiKey` 和 `Model`，然后打开 `http://127.0.0.1:5173`。更完整的启动方式（Nano 分支、Docker）见 [README](./README.md)，各子系统的扩展手册在 [docs/Development](./docs/Development/README.md)。

## 动手之前

- 从 `main` 拉一个开发分支，别直接在 `main` 上改。
- 读一下你要改的模块：核心模块都有自己的 README（比如 `Source/AgentSystem/Loop/README.md`），里面写着职责边界和扩展规则，几十行，值得花两分钟。
- 想清楚改动落在哪个范围——前端、后端/runtime、跨层、构建/CI 还是文档。这决定了你之后要跑哪些检查，也决定了你不用跑哪些。

## 几条硬规矩

这些不是风格偏好，是 CI 会拦的：

- **不写 `any`，不禁用 lint 规则来绕过报错。** 全仓库手写代码目前没有一个 `any`，lint 把 warning 也当错误。遇到类型报错，修类型，别压制它。
- **不为了让测试变绿而删测试**。新功能带测试，修 bug 带回归测试。测试统一放在 `Scripts/` 下，不散落在源码目录。
- **提交信息用 Conventional Commits**（`feat:`、`fix:`、`chore:` 这些），commitlint 会检查。
- **生成物不要手改。** 合同 JSON、协议文档、前端事件目录这些文件头部都标了"生成"，改它们的源头然后跑对应的 `npm run generate.*`，`verify.*` 门禁会比对是否同步。

## 本地要跑哪些检查

原则一句话：**只跑和你改动相关的，完整验收交给远端 CI。** 别每改一行就 `npm run ci`——那要跑十几分钟，而且 PR 上会再跑一遍，本地重复它没有意义。

| 改动范围       | 建议本地跑                                         |
| -------------- | -------------------------------------------------- |
| 前端           | `npm run check.frontend-types` + 相关前端测试      |
| 后端 / runtime | `npm run check.types` + 相关后端测试               |
| 跨层行为       | 两边类型检查 + 相关测试，必要时 `test.integration` |
| 构建 / CI      | 对应的 `verify.*` 套件                             |
| 文档 / 资源    | `npm run quality.format`，确认路径和链接没写错     |

跑单个测试文件用 vitest 直接指路径，比如：

```bash
npx vitest run --config vitest.backend.config.ts Scripts/BackendTests/Config/ConfigSecretRedactionBehavior.test.ts
```

提交前再看一眼 diff，确认没混进日志、缓存或和本次无关的文件。

## 提 Pull Request

推分支、开 PR，然后让 GitHub Actions 跑完整验收——**远端工作流是能不能合并的最终依据**，不是你的本地环境。

CI 挂了不用慌：只看失败 job 的日志（成功的不用翻），本地针对性修完再推，远端会自动复跑。

只有这几种情况才值得在本地跑全量验证（`npm run verify.all` 或 `npm run ci`）：

- CI 本身不可用；
- 你改的就是 CI、构建、测试框架或发布流程；
- 准备正式发布。

## 用 AI 助手开发？

可以，项目自己也这么干。但规矩对它一样生效：让它先读这份文件，盯着它别用 `any`、别禁 lint、别删测试来蒙混过关。它写的代码走一样的 review 和一样的 CI，出了问题记在你名下。
