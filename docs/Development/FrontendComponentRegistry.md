# 前端组件 Registry 接入约束

shadcn CLI 是第三方组件源码的受控入口，不是 Senera 的第二套设计系统。组件只有在适配项目结构、主题 token、交互契约和测试后，才能成为生产代码。

## 允许的操作

CLI 固定为 `Frontend/package.json` 中的精确版本。项目当前是 React 19 与 Tailwind 4（`@tailwindcss/vite`，`Frontend/src/index.css` 使用 `@import "tailwindcss"` 与 `@utility`，并用 `@config` 桥接 `tailwind.config.js`），但 `components.json` 仍声明 `style: "new-york"` 与 `tailwind.config` 这类 v3 形状的配置。CLI 在无法识别 workspace 根依赖时可能沿用该配置返回 v3 时代产物，因此接入前必须以 `view` 和 `dry-run` 比对实际输出，而不是假定某个固定风格地址就是正确的。

```bash
npm --workspace senera-frontend run ui.registry.view -- https://ui.shadcn.com/r/styles/new-york/tabs.json
npm --workspace senera-frontend run ui.registry.dry-run -- https://ui.shadcn.com/r/styles/new-york/tabs.json
```

- 只允许 `view` 和 `add --dry-run`。
- 禁止 `init`、写入式 `add`、`--all` 和 `--overwrite`。
- 官方组件使用 `https://ui.shadcn.com/r/styles/new-york/<component>.json`。
- 第三方 registry 必须先记录来源、许可证、依赖和用途，并在 `components.json` 中显式加入白名单。
- 不接受导入 `radix-ui` 聚合包，也不接受未适配的 v3 产物（`cssVariables: false` 时代的 token 形状、依赖 `tailwind.config` 扩展的写法、React 18 专用模式）；原生的 Tailwind 4 与 React 19 输出是目标形态。

## 生产接入

`components.json` 把潜在生成目标隔离到 `src/shared/ui/_incoming`。该目录只能用于本地检查，不能提交，也不能被生产代码导入。

接入组件时：

1. 先查看 registry 内容和依赖，再运行 dry-run。
2. 只添加实际需要的最小运行时依赖。
3. 把组件适配成 `src/shared/ui/ComponentName.tsx`，用现有 `cn`、语义 token 和 PascalCase 命名。
4. 从 `src/shared/ui/index.ts` 导出公共组件并添加同名 Ladle Story。
5. 覆盖键盘、焦点、禁用态、内容溢出和真实业务使用场景。

适配后的组件由 Senera 维护；重新生成不会自动合并上游改动。更新组件仍需重新审查 registry diff 和行为契约。
