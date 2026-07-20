# ActionPlanner 模块导览

ActionPlanner 模块负责理解当前请求，并在一次结构化调用中生成首个权威动作。首动作可以是 FinalAnswer、AskUser 或带 schema-shaped argumentHints 的 CallTools；Pi Harness 执行工具并把观察写回 transcript，后续动作才由 PiProxy 的 SelectPiAction 继续选择。

## 阅读顺序

1. `AgentActionPlanner.ts`：规划主入口，用单次 PrepareInteraction 同时生成 turn understanding 和 initialAction；运行 route 从已验证动作确定性投影。
2. `AgentActionPlannerModelClient.ts`：规划模型公开 API，保留 PrepareInteraction、Pi assistant 编译、工具安全审计和学习类调用入口。
3. `AgentActionPlannerStructuredCaller.ts`：统一 BAML 结构化调用、parse 和 repair 编排。
4. `AgentActionPlannerModelTransport.ts` / `AgentActionPlannerProviderResolver.ts`：模型 endpoint 传输和 planner provider 配置解析。
5. `AgentActionPlannerContext.ts`：把会话、工具、技能、planner memory 和 roleplay preset 投影成规划输入。
6. `AgentActionPlannerLedger.ts` / `AgentActionPlannerTimelineProjector.ts`：规划过程中的证据、工具调用、重复调用和 timeline 压缩。
7. `AgentPlanningCommandHandler.ts`：Agent loop 命令到 planner 调用的适配层。
8. `AgentInteractionRouter.ts`：从已验证首动作投影直接回复或工具循环模式，不再要求模型重复输出 route。
9. `AgentActionPlannerSchema.ts` / `AgentActionPlannerFailure.ts`：结构化结果校验、错误归一化和 repair 判断。
10. `AgentActionPlannerPromptJson.ts` / `AgentActionPlannerPromptProjector.ts`：统一 prompt payload 和模型请求体投影。

## 扩展规则

- 新增规划阶段时先扩展 telemetry、schema 和 context，再接入 planner 主入口。
- 模型输出必须走 schema 解析和 repair 流程，不在 loop 中解析临时字符串。
- planner 只消费结构化工具摘要、memory 和 timeline，不直接扫描插件目录。
- 首动作只能使用 Pi registry 投影的动态候选工具和真实 JSON Schema；候选集合先合并会话快照、Bootstrap 工具和 Skill 推荐工具。已注册但未激活的工具最多提升并重试一次，不按工具名写特例。
- Planner prompt、结构校验和 Pi 请求必须由同一 `loadedToolNames` 状态投影，禁止各层独立搜索或复制工具白名单。
- prepared action 通过一次性 lease 交给 PiProxy，工具结果产生后的请求必须重新执行 SelectPiAction，禁止重复消费首动作。
- 新增规划行为优先扩展 `VerifyToolSignatureMappingAndPlanValidation`、Pi 相关核心验证或相邻 loop 验证，避免新增零散专项脚本。
