# 术语表

这份术语表用于降低项目内部语言的理解成本。新增概念前，优先确认是否已经有对应术语。

`ActionPlanner`
结构化规划层。负责当前轮理解、任务契约、交互路由、证据校验和下一步动作。

`Artifact`
工具执行后的可追溯证据包。通常包含脱敏输入、原始输出、摘要、证据、模型投影、工作区 diff 和 manifest。

`Artifact Policy`
插件 manifest 中声明的证据提取规则。它决定 raw result 里的哪些字段会进入 evidence、summary、projection 或 workspace delta。

`Contract`
稳定边界。常见 contract 包括插件 manifest、tool signature、schema、事件类型、配置 schema、模型端点类型。

`Decision`
模型在某一步选择的运行时动作。可能是最终回答、工具调用、工具发现、向用户提问或其他注册的 decision action。

`Evidence`
从工具结果或 artifact 中提取的结构化事实。应该能通过 `evidenceUri` 追溯，通常也能回到对应 artifact。

`Host Capability`
由 Senera 宿主进程实现的工具能力。只在工具必须访问运行时内部服务时使用。

`Memory Candidate`
待合并的短期记忆候选。候选需要经过本地聚合、相似度、支持度和稳定性判断后，才会晋升为长期记忆。

`Memory Item`
长期记忆。可被回忆工具或 planner context 使用，应该有来源引用和置信度。

`Memory Source`
记忆的原始来源，例如用户消息、助手最终回复、工具证据或 artifact 引用。

`Plugin`
从 `System/Plugins` 或 `Plugins` 发现的能力包。插件可以声明工具、动作、技能、文档、权限、配置 schema 和 artifact policy。

`Projection`
把内部状态转换成某个消费者需要的形态。常见投影包括模型上下文、前端事件状态、artifact markdown、CLI 展示、配置表单。

`Root Command`
规划后生成的单步运行时指令。它规定本步允许的输出模式、工具范围和动作期望。

`Runtime Module`
对 `AgentRuntimeServices` 的可组合扩展。用于包装或替换服务，避免主运行时直接知道具体扩展。

`Skill`
插件声明的规划提示和工作流激活单元。Skill 影响规划和委派，但本身不执行工具。

`Tool Signature`
单个工具的参数和结果契约。驱动 schema 生成、提示投影、参数校验和工具调用规划。

`TurnUnderstanding`
当前用户输入的独立请求改写。它会结合对话上下文或角色预设解析省略、指代和上下文依赖。

`Workflow`
插件声明的高层任务分解。Workflow 可以选择子代理、上下文包和合并策略。

