# SQLite 持久化契约

每个 SQLite 领域在自己的仓库旁拥有一个 `Database/` 资源包：

```text
<Domain>/Database/
  contract.json
  runtime.json
  migrations/0001-<name>.sql
  snapshots/0001.schema.sql
```

`contract.json` 声明 store id、数据属于 `authoritative` 还是 `derived`，以及每个连续的迁移版本。每个版本引用不可变的 SQL 及其生成的 schema 快照，两者都带 SHA-256 哈希。SQL 文件是列、键、约束、默认值、索引和外键的唯一事实来源；TypeScript 只导入生成的 runtime 模块，不包含 DDL。

`runtime.json` 是生成的版本化模块产物，内含已验证的 SQL 和快照。运行时代码通过标准 JSON 模块契约导入它，因此 Node、Electron、Docker、Vitest 和打包器都不需要转换文件系统 URL。不要直接编辑它。

新增迁移后运行 `npm run generate.database-contracts`。它会把每个版本应用到全新的 SQLite 数据库、为每个版本写出规范的 `sqlite_master` 快照并刷新 manifest 哈希。`npm run verify.database-contracts` 检查已提交资源是否最新，它在每次构建前运行。`Build/CopyRuntimeAssets.ts` 会把 JSON 和 SQL 资源复制进 `Dist`，因此开发、Docker 和桌面打包运行时加载的是同一份契约。

运行时把所有权信息和不可变迁移账本保存在 `__senera_database_contract` 和 `__senera_schema_migrations`。这些控制表不进入领域快照。

- `authoritative` 存储在其规范 schema 与某个已声明历史版本完全一致时保留用户数据。运行时记录该版本，然后在 `BEGIN IMMEDIATE` 内应用后续 SQL 迁移。不支持或被手工改动的 schema 会直接拒绝并保留原文件；带有其他 store id 或数据类别显式元数据的数据库也会明确失败，因此路径配置错误不会抹掉另一个领域的数据。
- `derived` 存储保存可再生数据，例如工具搜索学习。当前契约直接复用；已声明的旧 schema、旧控制表或无法匹配的 schema 会在验证过的 staging 数据库中重建。替换前先把原数据库文件移到同目录的临时替换路径，只有新库校验成功后才移除；替换失败会恢复原文件。带有其他 store id 的显式元数据仍会明确失败，避免路径配置错误覆盖另一个领域的数据。

修改 schema 时新增一个编号 SQL 迁移。不要手工编辑已提交的迁移或快照，也不要为历史形态添加运行时兼容分支：应把它建模为已声明的版本化 SQL 迁移。`authoritative` 数据库不会因启动预检失败而自动删除，发布前必须通过备份、校验、dry-run 和回滚验证。
