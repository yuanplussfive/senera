import { describe, expect, test } from "vitest";
import { AgentTodoSystemTool } from "../../../Source/AgentSystem/SystemTools/AgentTodoSystemTool.js";
import { AgentTodoOperations, AgentTodoStatuses } from "../../../Source/AgentSystem/Todos/AgentTodoTypes.js";

describe("Todo system tool contract", () => {
  test("requires an explicit read, replace, or merge operation", () => {
    expect(AgentTodoSystemTool.input.safeParse({ operation: AgentTodoOperations.Read }).success).toBe(true);
    expect(
      AgentTodoSystemTool.input.safeParse({
        operation: AgentTodoOperations.Replace,
        todos: [{ id: "plan", content: "Inspect the change", status: AgentTodoStatuses.Pending }],
      }).success,
    ).toBe(true);
    expect(
      AgentTodoSystemTool.input.safeParse({
        operation: AgentTodoOperations.Merge,
        todos: [{ id: "plan", status: AgentTodoStatuses.Completed }],
      }).success,
    ).toBe(true);
    expect(AgentTodoSystemTool.input.safeParse({ todos: [] }).success).toBe(false);
    expect(AgentTodoSystemTool.input.safeParse({ operation: AgentTodoOperations.Read, todos: [] }).success).toBe(false);
  });
});
