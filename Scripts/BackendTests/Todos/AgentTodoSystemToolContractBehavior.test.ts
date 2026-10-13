import { describe, expect, test } from "vitest";
import {
  AgentTodoAddSystemTool,
  AgentTodoReadSystemTool,
  AgentTodoUpdateSystemTool,
  AgentTodoSystemTools,
} from "../../../Source/AgentSystem/SystemTools/AgentTodoSystemTool.js";
import { AgentTodoStatuses, AgentTodoToolNames } from "../../../Source/AgentSystem/Todos/AgentTodoTypes.js";

describe("Todo system tool contracts", () => {
  test("expose separate create, patch, and read tools", () => {
    expect(AgentTodoSystemTools.map((tool) => tool.name)).toEqual([
      AgentTodoToolNames.Add,
      AgentTodoToolNames.Update,
      AgentTodoToolNames.Read,
    ]);
  });

  test("adds content-bearing tasks without asking the model to invent IDs", () => {
    expect(
      AgentTodoAddSystemTool.input.safeParse({
        tasks: [{ content: "Inspect the change" }],
      }).success,
    ).toBe(true);
    expect(AgentTodoAddSystemTool.input.safeParse({ tasks: [{ content: " " }] }).success).toBe(false);
    expect(AgentTodoAddSystemTool.input.safeParse({ tasks: [{ content: "Inspect", id: "model-id" }] }).success).toBe(
      false,
    );
    expect(
      AgentTodoAddSystemTool.input.safeParse({ tasks: [{ content: "Inspect", status: AgentTodoStatuses.Completed }] })
        .success,
    ).toBe(false);
    expect(AgentTodoAddSystemTool.input.safeParse({ tasks: [] }).success).toBe(false);
  });

  test("updates existing IDs with an explicit non-empty patch", () => {
    expect(
      AgentTodoUpdateSystemTool.input.safeParse({
        updates: [{ id: "todo-id", status: AgentTodoStatuses.Completed }],
      }).success,
    ).toBe(true);
    expect(
      AgentTodoUpdateSystemTool.input.safeParse({
        updates: [{ id: "todo-id", content: "Updated description" }],
      }).success,
    ).toBe(true);
    expect(
      AgentTodoUpdateSystemTool.input.safeParse({
        updates: [{ id: "todo-id", content: "Updated description", status: AgentTodoStatuses.Completed }],
      }).success,
    ).toBe(true);
    expect(AgentTodoUpdateSystemTool.input.safeParse({ updates: [{ id: "todo-id" }] }).success).toBe(false);
    expect(AgentTodoUpdateSystemTool.input.safeParse({ updates: [] }).success).toBe(false);
  });

  test("reads the task list with no model-authored selector fields", () => {
    expect(AgentTodoReadSystemTool.input.safeParse({}).success).toBe(true);
    expect(AgentTodoReadSystemTool.input.safeParse({ sessionId: "session-1" }).success).toBe(false);
    expect(AgentTodoReadSystemTool.metadata.search?.Capabilities?.[0]?.Risk).toMatchObject({
      SideEffect: "read-only",
      Permission: "read",
    });
  });
});
