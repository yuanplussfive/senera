import { z } from "zod";
import type { AgentHostToolContext } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { AgentTodoChangeSources, AgentTodoStatuses, AgentTodoToolNames } from "../Todos/AgentTodoTypes.js";
import type { AgentTodoService } from "../Todos/AgentTodoService.js";
import {
  AgentHostToolProtocolVersion,
  ToolResultAssessmentPolicies,
  ToolSchedulingModes,
} from "../Types/AgentToolContractTypes.js";
import {
  defineSystemTool,
  type AgentSystemToolDefinition,
  type AgentSystemToolMetadata,
} from "./AgentSystemToolDefinition.js";

const NonEmptyText = z.string().trim().min(1);
const TodoStatus = z.enum(AgentTodoStatuses);

const TodoCounts = z
  .object({
    total: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    inProgress: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
  })
  .strict();

const TodoTaskReference = z
  .object({
    id: z.string(),
    status: TodoStatus,
  })
  .strict();

const TodoReadOutput = z
  .object({
    items: z.array(
      z
        .object({
          id: z.string(),
          content: z.string(),
          status: TodoStatus,
          order: z.number().int().nonnegative(),
          createdAt: z.string(),
          updatedAt: z.string(),
        })
        .strict(),
    ),
    counts: TodoCounts,
  })
  .strict();

const TodoAddInput = z
  .object({
    tasks: z
      .array(
        z
          .object({
            content: NonEmptyText.describe("Task description."),
          })
          .strict(),
      )
      .min(1)
      .describe("Tasks to add. New tasks start pending; the tool assigns stable IDs and returns them."),
  })
  .strict();

const TodoUpdateItem = z.union([
  z
    .object({
      id: NonEmptyText.describe("Stable ID returned by TodoAdd or TodoRead."),
      status: TodoStatus.describe("Replacement status for this task."),
    })
    .strict(),
  z
    .object({
      id: NonEmptyText.describe("Stable ID returned by TodoAdd or TodoRead."),
      content: NonEmptyText.describe("Replacement task description."),
    })
    .strict(),
  z
    .object({
      id: NonEmptyText.describe("Stable ID returned by TodoAdd or TodoRead."),
      content: NonEmptyText.describe("Replacement task description."),
      status: TodoStatus.describe("Replacement status for this task."),
    })
    .strict(),
]);

const TodoUpdateInput = z
  .object({
    updates: z
      .array(TodoUpdateItem)
      .min(1)
      .describe("Existing task IDs and the fields to change. Omitted fields remain unchanged."),
  })
  .strict();

const TodoAddOutput = z
  .object({
    created: z.array(TodoTaskReference),
    counts: TodoCounts,
  })
  .strict();

const TodoUpdateOutput = z
  .object({
    updated: z.array(TodoTaskReference),
    counts: TodoCounts,
  })
  .strict();

const TodoExtension = {
  name: "todo",
  displayName: { "zh-CN": "任务清单", "en-US": "Task List" },
  description: { "zh-CN": "维护本轮任务清单。", "en-US": "Maintains the task list for this turn." },
  priority: 2,
  childGrant: "internal" as const,
};

interface TodoToolMetadataInput {
  readonly description: string;
  readonly summary: string;
  readonly capabilityId: string;
  readonly capabilityDescription: string;
  readonly actions: readonly string[];
  readonly aliases: readonly string[];
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly useCases: readonly string[];
  readonly examples: readonly string[];
  readonly avoid: readonly string[];
  readonly permission: "read" | "write";
  readonly effect: string;
  readonly sideEffect: string;
}

function createTodoToolMetadata(input: TodoToolMetadataInput): AgentSystemToolMetadata {
  return {
    description: input.description,
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
      Summary: input.summary,
      Tags: ["任务清单", "todo", "计划", "进度"],
      Capabilities: [
        {
          Id: input.capabilityId,
          Title: "Task list management",
          Description: input.capabilityDescription,
          Facets: {
            Actions: [...input.actions],
            Targets: ["session-task-list"],
            Inputs: [...input.inputs],
            Outputs: [...input.outputs],
            Effects: [input.effect],
          },
          Aliases: [...input.aliases],
          Risk: { SideEffect: input.sideEffect, Permission: input.permission },
        },
      ],
      UseCases: [...input.useCases],
      Examples: [...input.examples],
      Avoid: [...input.avoid],
    },
  };
}

function requireTodoContext(context: AgentHostToolContext): { sessionId: string; todoService: AgentTodoService } {
  if (!context.sessionId) throw new Error("Todo requires an active session.");
  if (!context.todoService) throw new Error("Todo service is not connected to the runtime.");
  return { sessionId: context.sessionId, todoService: context.todoService };
}

export const AgentTodoAddSystemTool = defineSystemTool({
  extension: TodoExtension,
  metadata: createTodoToolMetadata({
    description:
      "Add one or more pending tasks to the current session. The tool assigns stable IDs; use TodoUpdate to change their status or description.",
    summary: "向本轮任务清单新增步骤，并返回稳定任务 ID。",
    capabilityId: "todo.add",
    capabilityDescription: "Create tasks and receive their stable IDs.",
    actions: ["add"],
    aliases: ["新增任务", "添加待办", "创建任务步骤", "add todo task"],
    inputs: ["tasks", "content"],
    outputs: ["created-task-ids", "task-counts"],
    useCases: ["为多步骤工作创建任务清单", "执行中发现新的独立工作步骤"],
    examples: ["为这个实现任务建立步骤清单", "新增一个验证步骤"],
    avoid: ["不要用它修改已有任务状态", "简单的一步请求无需建立清单"],
    permission: "write",
    effect: "session-state",
    sideEffect: "session-state",
  }),
  name: AgentTodoToolNames.Add,
  input: TodoAddInput,
  output: TodoAddOutput,
  execute(input, context) {
    const { sessionId, todoService } = requireTodoContext(context);
    const result = todoService.add({
      sessionId,
      tasks: input.tasks,
      onEvent: context.onEvent,
      requestId: context.requestId,
      source: AgentTodoChangeSources.Model,
    });
    return { created: [...result.created], counts: result.counts };
  },
});

export const AgentTodoUpdateSystemTool = defineSystemTool({
  extension: TodoExtension,
  metadata: createTodoToolMetadata({
    description:
      "Update existing tasks by stable ID. Send only the fields to change; omitted content or status stays unchanged. Use TodoAdd for new tasks and TodoRead to inspect IDs. Keep at most one task in_progress; zero is valid when all work is terminal. Mark completed only after verification.",
    summary: "按稳定任务 ID 更新描述或状态，未传字段保持不变。",
    capabilityId: "todo.update",
    capabilityDescription: "Patch existing task content or status by stable ID.",
    actions: ["update", "complete", "cancel"],
    aliases: ["更新任务状态", "标记任务完成", "取消任务", "update todo status"],
    inputs: ["updates", "id", "content", "status"],
    outputs: ["updated-task-ids", "task-counts"],
    useCases: ["推进已创建任务的状态", "修订现有任务描述", "标记已验证完成或无法继续的任务"],
    examples: ["把对应任务标记为完成", "将当前任务设为进行中"],
    avoid: ["不要用它创建新任务", "不要在验证前标记完成"],
    permission: "write",
    effect: "session-state",
    sideEffect: "session-state",
  }),
  name: AgentTodoToolNames.Update,
  input: TodoUpdateInput,
  output: TodoUpdateOutput,
  execute(input, context) {
    const { sessionId, todoService } = requireTodoContext(context);
    const result = todoService.update({
      sessionId,
      updates: input.updates,
      onEvent: context.onEvent,
      requestId: context.requestId,
      source: AgentTodoChangeSources.Model,
    });
    return { updated: [...result.updated], counts: result.counts };
  },
});

export const AgentTodoReadSystemTool = defineSystemTool({
  extension: TodoExtension,
  metadata: createTodoToolMetadata({
    description: "Read all tasks and their current statuses for the active session.",
    summary: "读取本轮任务清单、稳定 ID 与当前状态。",
    capabilityId: "todo.read",
    capabilityDescription: "Read the current session task list and status counts.",
    actions: ["read"],
    aliases: ["查看任务清单", "读取待办状态", "list todo tasks"],
    inputs: [],
    outputs: ["task-list", "task-counts"],
    useCases: ["需要核对任务 ID、描述或状态"],
    examples: ["查看当前任务进度"],
    avoid: ["已有清晰任务上下文时不要重复读取"],
    permission: "read",
    effect: "session-state-read",
    sideEffect: "read-only",
  }),
  name: AgentTodoToolNames.Read,
  input: z.object({}).strict(),
  output: TodoReadOutput,
  execute(_input, context) {
    const { sessionId, todoService } = requireTodoContext(context);
    const snapshot = todoService.read(sessionId);
    return { items: [...snapshot.items], counts: snapshot.counts };
  },
});

export const AgentTodoSystemTools: readonly AgentSystemToolDefinition[] = [
  AgentTodoAddSystemTool,
  AgentTodoUpdateSystemTool,
  AgentTodoReadSystemTool,
];
