import type { AgentHostToolContext } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { AgentTodoChangeSources } from "../Todos/AgentTodoTypes.js";
import { type AgentTodoService, type AgentTodoWriteInput } from "../Todos/AgentTodoService.js";
import { defineSystemTool, systemToolArguments, type AgentSystemToolDefinition } from "./AgentSystemToolDefinition.js";

function requireTodoContext(context: AgentHostToolContext): { sessionId: string; todoService: AgentTodoService } {
  if (!context.sessionId) throw new Error("Todo requires an active session.");
  if (!context.todoService) throw new Error("Todo service is not connected to the runtime.");
  return { sessionId: context.sessionId, todoService: context.todoService };
}

export const AgentTodoWriteSystemTool = defineSystemTool({
  capability: "system.tool.todo.write",
  execute(input, context) {
    const args = systemToolArguments<Pick<AgentTodoWriteInput, "todos">>(input);
    const { sessionId, todoService } = requireTodoContext(context);
    const snapshot = todoService.write({
      sessionId,
      todos: args.todos,
      requestId: context.requestId,
      onEvent: context.onEvent,
      source: AgentTodoChangeSources.Model,
    });
    return { todos: snapshot.items.map(({ content, status }) => ({ content, status })) };
  },
});

export const AgentTodoSystemTools: readonly AgentSystemToolDefinition[] = [AgentTodoWriteSystemTool];
