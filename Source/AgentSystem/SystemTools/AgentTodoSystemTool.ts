import { z } from "zod";
import { defineSystemTool } from "./AgentSystemToolDefinition.js";
import { StandardAgentToolObservationProjection } from "../ToolRuntime/AgentToolObservationProjectionPlan.js";
import {
  AgentHostToolProtocolVersion,
  ToolResultAssessmentPolicies,
  ToolSchedulingModes,
} from "../Types/AgentToolContractTypes.js";
import { AgentTodoOperations, AgentTodoStatuses } from "../Todos/AgentTodoTypes.js";

const NonEmptyText = z.string().trim().min(1);
const TodoItemInput = z
  .object({
    id: NonEmptyText.describe("Stable identifier for this task."),
    content: NonEmptyText.optional().describe("Task description. Required when adding a new item."),
    status: z.enum(AgentTodoStatuses).optional().describe("Current task status."),
  })
  .strict();

const TodoReadInput = z
  .object({
    operation: z.literal(AgentTodoOperations.Read).describe("Read the current task list without changing it."),
  })
  .strict();

const TodoWriteInput = z
  .object({
    operation: z
      .enum([AgentTodoOperations.Replace, AgentTodoOperations.Merge])
      .describe("Replace the full list or merge updates by stable item id."),
    todos: z.array(TodoItemInput).describe("Task items to write. Use stable ids for later updates."),
  })
  .strict();

const TodoInput = z.discriminatedUnion("operation", [TodoReadInput, TodoWriteInput]);

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
      "zh-CN": "维护本轮任务清单。",
      "en-US": "Maintains the task list for this turn.",
    },
    priority: 2,
    childGrant: "internal",
  },
  metadata: {
    observation: StandardAgentToolObservationProjection,
    description:
      "Manage the current session task list. Choose operation=read to inspect it, operation=replace to create a plan, or operation=merge to update stable item ids. Keep exactly one item in_progress. Mark completed only after verification; cancel failed work and add a revised item.",
    permissions: ["session:todo"],
    execution: { Targets: ["Local"], Network: "Deny", Workspace: "ReadOnly" },
    runtime: {
      Lifecycle: "Immediate",
      ProtocolVersion: AgentHostToolProtocolVersion,
      ResultAssessment: ToolResultAssessmentPolicies.ProcessExit,
      Scheduling: ToolSchedulingModes.SelfManaged,
      Capabilities: { Cancellation: true },
    },
    search: {
      Summary: "任务清单。",
      Tags: ["任务清单", "todo", "计划", "复杂任务", "进度"],
      Capabilities: [
        {
          Id: "todo.manage",
          Title: "Task list management",
          Description: "Read, replace, or merge the current session task list.",
          Facets: {
            Actions: ["read", "replace", "merge", "complete", "cancel"],
            Targets: ["session-task-list"],
            Inputs: ["operation", "todos", "id", "content", "status"],
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
    if (input.operation === AgentTodoOperations.Read) {
      return TodoOutput.parse(context.todoService.read(context.sessionId));
    }
    const snapshot = context.todoService.write({
      sessionId: context.sessionId,
      items: input.todos,
      merge: input.operation === AgentTodoOperations.Merge,
      onEvent: context.onEvent,
      requestId: context.requestId,
    });
    return TodoOutput.parse(snapshot);
  },
});
