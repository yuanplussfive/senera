# 配置命令契约

系统配置的变更命令独立于传输处理器和 UI 代码进行版本化。

- `versions/*.json` 声明变更语义和身份字段。
- `snapshots/*.schema.json` 是已发布版本的不可变 JSON Schema 投影。
- `runtime.json` 从最新版本生成，供运行时校验器消费。
- `contract.json` 记录连续版本和 SHA-256 校验和。

已发布的文件不可变。修改命令契约的方式是追加一个新版本，然后运行 `npm run generate.config-command-contracts`。
