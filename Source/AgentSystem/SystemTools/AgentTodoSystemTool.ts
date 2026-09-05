import { z } from "zod";
import { defineSystemTool } from "./AgentSystemToolDefinition.js";
import { StandardAgentToolObservationProjection } from "../ToolRuntime/AgentToolObservationProjectionPlan.js";
import {
  AgentHostToolProtocolVersion,
  ToolResultAssessmentPolicies,
  ToolSchedulingModes,
} from "../Types/AgentToolContractTypes.js";
import { AgentTodoStatuses } from "../Todos/AgentTodoTypes.js";

const NonEmptyText = z.string().trim().min(1);
const TodoItemInput = z
  .object({
    id: NonEmptyText.describe("Stable identifier for this task."),
    content: NonEmptyText.optional().describe("Task description. Required when adding a new item."),
    status: z.enum(AgentTodoStatuses).optional().describe("Current task status."),
  })
  .strict();

const TodoInput = z
  .object({
    todos: z
      .array(TodoItemInput)
      .optional()
      .describe("Omit to read the current list. Provide items to replace or merge the current list."),
    merge: z
      .boolean()
      .optional()
      .describe(
        "Required when todos is provided: false replaces the full list; true updates items by id and appends new items.",
      ),
  })
  .strict();

const TodoItem = z
  .object({
    id: z.string(),
    content: z.string(),
    status: z.enum(AgentTodoStatuses),
    order: z.number().int().nonnegative(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

const TodoCounts = z
  .object({
    total: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    inProgress: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
  })
  .strict();

const TodoOutput = z
  .object({
    items: z.array(TodoItem),
    counts: TodoCounts,
  })
  .strict();

export const AgentTodoSystemTool = defineSystemTool({
  extension: {
    name: "todo",
    displayName: {
      "zh-CN": "任务清单",
      "en-US": "Task List",
    },
    description: {
      "zh-CN": "管理当前会话的复杂任务清单，不与长期 Goal 混用。",
      "en-US": "Manages the current-session task list without mixing it with durable Goals.",
    },
    priority: 2,
  },
  metadata: {
    observation: StandardAgentToolObservationProjection,
    description:
      "Manage the current session task list. Use for complex work with multiple concrete steps. Omit todos to read the list. Provide todos to write it. Replace mode creates a fresh plan; merge mode updates existing ids and appends new items. Keep exactly one item in_progress. Mark completed only after verification; cancel failed work and add a revised item.",
    permissions: ["session:todo"],
    execution: { Targets: ["Local"], Network: "Deny", Workspace: "ReadWrite" },
    runtime: {
      Lifecycle: "Immediate",
      ProtocolVersion: AgentHostToolProtocolVersion,
      ResultAssessment: ToolResultAssessmentPolicies.ProcessExit,
      Scheduling: ToolSchedulingModes.SelfManaged,
      Capabilities: { Cancellation: true },
    },
    search: {
      Summary: "管理当前会话的多步骤任务清单并返回完整状态。",
      Tags: ["任务清单", "todo", "计划", "复杂任务", "进度"],
      Capabilities: [
        {
          Id: "todo.manage",
          Title: "Task list management",
          Description: "Read, replace, or merge the current session task list.",
          Facets: {
            Actions: ["read", "replace", "merge", "complete", "cancel"],
            Targets: ["session-task-list"],
            Inputs: ["todos", "id", "content", "status", "merge"],
            Outputs: ["task-list", "task-counts"],
            Effects: ["session-state"],
          },
          Aliases: ["列出待办", "创建任务清单", "更新任务进度", "todo"],
          Risk: { SideEffect: "session-state", Permission: "write" },
        },
      ],
      UseCases: ["复杂任务需要拆分步骤", "用户提出多个需要逐项完成的要求"],
      Examples: ["列出实现这个功能的步骤", "更新当前任务清单"],
      Avoid: ["不要把长期用户目标写入 Todo", "简单的一步任务不要创建清单"],
    },
  },
  name: "Todo",
  input: TodoInput,
  output: TodoOutput,
  execute(input, context) {
    if (!context.sessionId) throw new Error("Todo requires an active session.");
    if (!context.todoService) throw new Error("Todo service is not connected to the runtime.");
    if (input.todos === undefined) {
      if (input.merge !== undefined) throw new Error("Todo read does not accept merge.");
      return TodoOutput.parse(context.todoService.read(context.sessionId));
    }
    if (input.merge === undefined) throw new Error("Todo write requires an explicit merge value.");
    const snapshot = context.todoService.write({
      sessionId: context.sessionId,
      items: input.todos,
      merge: input.merge,
      onEvent: context.onEvent,
      requestId: context.requestId,
    });
    return TodoOutput.parse(snapshot);
  },
});
