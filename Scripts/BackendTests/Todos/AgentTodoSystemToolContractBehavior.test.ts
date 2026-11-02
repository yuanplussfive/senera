import { describe, expect, test } from "vitest";
import {
  AgentTodoWriteSystemTool,
  AgentTodoSystemTools,
} from "../../../Source/AgentSystem/SystemTools/AgentTodoSystemTool.js";
import { AgentTodoToolNames } from "../../../Source/AgentSystem/Todos/AgentTodoTypes.js";
import {
  loadSystemToolContractByCapability,
  materializeSystemToolArguments,
} from "../SystemTools/SystemToolContractTestSupport.js";

describe("Todo system tool contracts", () => {
  test("publishes one full replacement contract", () => {
    expect(
      AgentTodoSystemTools.map((tool) => loadSystemToolContractByCapability(tool.capability).contract.name),
    ).toEqual([AgentTodoToolNames.Write]);
    const contract = loadSystemToolContractByCapability(AgentTodoWriteSystemTool.capability);
    expect(
      materializeSystemToolArguments(contract, { todos: [{ content: "Inspect", status: "in_progress" }] }).ok,
    ).toBe(true);
    expect(materializeSystemToolArguments(contract, { todos: [] }).ok).toBe(true);
    expect(materializeSystemToolArguments(contract, { todos: [{ content: " ", status: "pending" }] }).ok).toBe(false);
    expect(
      materializeSystemToolArguments(contract, { todos: [{ content: "Inspect", status: "pending", id: "invented" }] })
        .ok,
    ).toBe(false);
    expect(materializeSystemToolArguments(contract, { todos: [{ content: "Inspect" }] }).ok).toBe(false);
    expect(materializeSystemToolArguments(contract, { todos: [], sessionId: "other" }).ok).toBe(false);
  });
});
