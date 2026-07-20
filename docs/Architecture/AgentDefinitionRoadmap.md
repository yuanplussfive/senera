# Agent Definition 领域路线图（延期）

状态：Deferred，不属于当前前端重构实施范围

日期：2026-07-15

## 1. 记录目的

该文档用于确保“一级 Agent Definition”不会因为本轮前端重构暂不实施而被遗忘，也避免未来在前端、Preset 或 Session 中临时堆字段形成隐性领域模型。

当前前端工作只允许为未来 Agent 能力保留可扩展边界，不得假装已有完整 Agent 后端，也不得将现有 Preset 直接改名为 Agent。

## 2. 当前系统边界

### Session

当前 `AgentSession` 主要保存会话、状态、Metadata 和 Active Request。Metadata 目前聚焦标题与最近一次模型运行信息，不包含 Agent ID、Agent Revision、工具策略、权限策略或 Agent Snapshot。

### WebSocket

当前 `session.create` 和 `session.message` 支持 Session、Model Provider、输入、附件与队列模式，不包含 Agent Definition、Agent Override 或 Agent Revision。

### Preset

当前 Preset 是工作区内 `.json`、`.md`、`.txt` 文件及一个全局 `activePresetName`。它更接近角色提示或任务模板，不是完整 Agent Definition。

### Runtime

当前运行协调主要按 `modelProviderId` 创建 Loop，并从全局 Runtime Services 获得 Prompt、Preset、Plugin、Tool 与安全能力。系统尚未提供：

```text
System Default
→ Agent Definition
→ Session Override
→ Run Override
→ Effective Run Profile
```

## 3. 为什么从本轮拆出

完整 Agent Definition 会影响：

- 领域术语和 Schema。
- Repository 与持久化。
- Session Binding。
- Agent Revision 与 Snapshot。
- WebSocket Protocol。
- Runtime Effective Config。
- Prompt、Model、Tool、Skill 与 Permission 合并。
- Preset 迁移。
- 导入、导出、复制与删除规则。
- 旧 Session 兼容。

这属于中到大型后端领域工作，不应与主工作区前端 Surface 重构同时实施。

## 4. 建议领域模型（仅供未来设计）

未来可以评估类似模型：

```ts
interface AgentDefinition {
  id: string;
  revision: number;
  name: string;
  description?: string;
  instructions: string;
  modelProviderId?: string;
  toolPolicy: unknown;
  skillIds: string[];
  permissionProfileId?: string;
  resourceBindings: unknown[];
  createdAt: string;
  updatedAt: string;
}
```

该示例不是已批准 Schema。正式实施前必须通过领域建模确定术语、职责和不变量。

## 5. 必须先回答的领域问题

1. Agent 是全局资源、工作区资源还是用户资源？
2. Session 是绑定 Agent 最新版本，还是创建时 Snapshot？
3. 修改 Agent 后，历史 Session 如何继续运行？
4. Agent 的 Tool、Skill 与 Permission 是白名单、默认值还是硬约束？
5. Session Override 可以覆盖哪些 Agent 属性？
6. Preset 是 Agent 模板、任务模板还是纯 Prompt 文档？
7. Plugin、Tool、Skill、Workflow 与 Agent 的关系是什么？
8. 内置 Agent 与用户 Agent 如何区分和升级？
9. 删除 Agent 后历史任务如何恢复？
10. Agent 导入包是否允许携带权限、外部 URL 或敏感配置？

## 6. 推荐阶段

### Phase A：领域设计

- 建立 ubiquitous language。
- 定义 Agent、Preset、Task/Session、Run、Tool、Skill、Permission、Workflow 的边界。
- 写 ADR 与兼容策略。
- 不修改生产代码。

### Phase B：Definition Repository

- Agent Definition Schema。
- Repository。
- List/Get/Create/Update/Delete/Clone。
- Revision。
- Import/Export 安全边界。

### Phase C：Session Binding

- Session 绑定 Agent ID 与 Revision/Snapshot。
- 老 Session 无 Agent 时的默认解释。
- 删除和升级规则。
- 存储迁移。

### Phase D：Effective Run Profile

```text
System Default
+ Agent Definition
+ Session Override
+ Run Override
= Effective Run Profile
```

输出可审计快照，供 Prompt、Model、Tool、Skill、Permission、Planning 与 Sandbox 使用。

### Phase E：Protocol

评估新增：

- `agent.list`
- `agent.get`
- `agent.create`
- `agent.update`
- `agent.delete`
- `agent.clone`
- `agent.import`
- `agent.export`

并扩展 Session 创建、列表、历史和运行事件。

### Phase F：Preset Migration

- 明确哪些 Preset 仍是文档模板。
- 明确哪些 Preset 可以转换为 Agent Template。
- 不自动把所有历史 Preset 升级成 Agent。
- 提供可回滚迁移。

### Phase G：Agent Workspace UI

后端契约稳定后再实现：

- Agent 列表。
- Agent 编辑器。
- 工具、Skill 与权限选择。
- 测试运行。
- 从 Agent 创建任务。
- 版本与使用情况。

## 7. 启动条件

只有同时满足以下条件，才应开始正式实施：

1. 当前主工作区前端重构已经稳定。
2. Session Override 的产品语义明确。
3. Preset 的长期定位已经确定。
4. Plugin、Tool、Skill 与 Permission 边界完成领域建模。
5. 旧 Session 与旧 Preset 的兼容方案完成。
6. 用户明确批准开始后端 Agent Definition 工作。
7. 建立独立 Trellis 任务，不复用前端 UI 重构任务。

## 8. 当前前端可以做什么

允许：

- 使用中性、可扩展的 Task Profile/Source 展示契约。
- 避免在组件中写死“Preset 永远等于 Agent”。
- 为未来导航入口保留可插入位置，但不显示空入口。
- 保持 Composer 的 Preset 选择器职责清楚。

禁止：

- 在前端伪造 `agentId` 并只存本地状态。
- 把 Preset UI 文案直接改成 Agent。
- 在 Session Metadata 中临时塞入未经建模的复杂 Agent 配置。
- 添加没有后端实现的 Agent CRUD。
- 让不同 Surface 各自维护 Agent 草稿。

## 9. Trellis 后续任务建议

建议未来建立独立任务：

```text
agent-definition-domain-model
```

初始状态：planned/deferred。

任务至少包含：

- PRD：用户为什么需要多个 Agent。
- Design：领域模型、存储、协议、Runtime 合并和迁移。
- 验证：旧 Session、旧 Preset、权限和导入安全。

当前工作区未提供可用的 `.trellis/scripts/task.py` harness，因此本次只记录正式路线图，不创建平行任务系统。Trellis harness 可用后再创建该延期任务。

## 10. 防遗忘触发词

未来出现下列需求时，必须回到本路线图：

- 创建多个 Agent。
- Agent 使用独立工具或权限。
- Session 绑定 Agent。
- 子 Agent 或多 Agent。
- Agent 知识库。
- 分享、导入、导出 Agent。
- Agent 模板。
- Agent 版本与升级。
- 修改 Agent 后旧任务如何继续。

## 11. 当前决策

完整 Agent Definition 已被明确延期，不属于前端 Agent 工作区重构。该延期是范围控制，不是否定该能力的产品价值。
