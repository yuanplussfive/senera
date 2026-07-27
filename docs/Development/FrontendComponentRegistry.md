# 前端组件 Registry 接入约束

shadcn CLI 是第三方组件源码的受控入口，不是 Senera 的第二套设计系统。组件只有在适配项目结构、主题 token、交互契约和测试后，才能成为生产代码。

## 允许的操作

CLI 固定为 `Frontend/package.json` 中的精确版本。当前 React 18 与 Tailwind 3 项目必须使用显式的 legacy registry 地址，避免 CLI 在无法识别 workspace 根依赖时返回 Tailwind 4 组件。

```bash
npm --workspace senera-frontend run ui.registry.view -- https://ui.shadcn.com/r/styles/new-york/tabs.json
npm --workspace senera-frontend run ui.registry.dry-run -- https://ui.shadcn.com/r/styles/new-york/tabs.json
```

- 只允许 `view` 和 `add --dry-run`。
- 禁止 `init`、写入式 `add`、`--all` 和 `--overwrite`。
- 官方组件使用 `https://ui.shadcn.com/r/styles/new-york/<component>.json`。
- 第三方 registry 必须先记录来源、许可证、依赖和用途，并在 `components.json` 中显式加入白名单。
- 不接受导入 `radix-ui` 聚合包、Tailwind 4 专用语法或要求 React 19 的输出。

## 生产接入

`components.json` 把潜在生成目标隔离到 `src/shared/ui/_incoming`。该目录只能用于本地检查，不能提交，也不能被生产代码导入。

接入组件时：

1. 先查看 registry 内容和依赖，再运行 dry-run。
2. 只添加实际需要的最小运行时依赖。
3. 将组件适配为 `src/shared/ui/ComponentName.tsx`，使用现有 `cn`、语义 token 和 PascalCase 命名。
4. 从 `src/shared/ui/index.ts` 导出公共组件并添加同名 Ladle Story。
5. 覆盖键盘、焦点、禁用态、内容溢出和真实业务使用场景。

适配后的组件由 Senera 维护；重新生成不会自动合并上游改动。更新组件仍需重新审查 registry diff 和行为契约。
