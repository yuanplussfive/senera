# ActionPlanner 模块导览

ActionPlanner 模块负责理解当前请求、构建任务合约、判断证据是否足够，以及在需要工具时生成结构化工具调用计划。

## 阅读顺序

1. `AgentActionPlanner.ts`：规划主入口，串联 turn understanding、task frame、evidence evaluation 和 tool-call planning。
2. `AgentActionPlannerModelClient.ts`：规划模型公开 API，保留 BuildTaskFrame、PlanToolCalls、LearnMemory 等调用入口。
3. `AgentActionPlannerStructuredCaller.ts`：统一 BAML 结构化调用、parse 和 repair 编排。
4. `AgentActionPlannerModelTransport.ts` / `AgentActionPlannerProviderResolver.ts`：模型 endpoint 传输和 planner provider 配置解析。
5. `AgentActionPlannerContext.ts`：把会话、工具、技能、planner memory 和 roleplay preset 投影成规划输入。
6. `AgentActionPlannerLedger.ts` / `AgentActionPlannerTimelineProjector.ts`：规划过程中的证据、工具调用、重复调用和 timeline 压缩。
7. `AgentPlanningCommandHandler.ts` / `AgentToolCallPlanningCommandHandler.ts`：Agent loop 命令到 planner 调用的适配层。
8. `AgentInteractionRouter.ts`：把当前 turn 路由到直接回复、工具循环或深度任务模式。
9. `AgentActionPlannerSchema.ts` / `AgentActionPlannerFailure.ts`：结构化结果校验、错误归一化和 repair 判断。
10. `AgentActionPlannerStageRunner.ts` / `AgentActionPlannerRepairLoop.ts`：阶段 telemetry 和通用 repair 循环。
11. `AgentActionPlannerEvidenceProjection.ts` / `AgentToolCallPlanningOutcome.ts`：证据验证投影和空工具计划降级结果。
12. `AgentActionPlannerPromptJson.ts` / `AgentActionPlannerPromptProjector.ts`：统一 prompt payload 和模型请求体投影。

## 扩展规则

- 新增规划阶段时先扩展 telemetry、schema 和 context，再接入 planner 主入口。
- 模型输出必须走 schema 解析和 repair 流程，不在 loop 中解析临时字符串。
- planner 只消费结构化工具契约、memory 和 timeline，不直接扫描插件目录。
- 新增规划行为必须补 `Scripts/VerifyActionPlanner*.ts` 或相关 loop 验证。
