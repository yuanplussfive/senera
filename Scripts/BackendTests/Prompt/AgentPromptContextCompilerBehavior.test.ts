import { describe, expect, test } from "vitest";
import { buildAgentExecutionEnvironmentContext } from "../../../Source/AgentSystem/Prompt/AgentExecutionEnvironmentContext.js";
import { compileAgentPromptContext } from "../../../Source/AgentSystem/Prompt/AgentPromptContextCompiler.js";
import { EmptyAgentContinuityMemoryPromptContext } from "../../../Source/AgentSystem/Continuity/AgentContinuityMemoryTypes.js";
import { toolRootCommand } from "../Support/AgentTestFixtures.js";
import { EmptyAgentWorkflowPromptContext } from "../../../Source/AgentSystem/Prompt/AgentWorkflowPromptContext.js";

function compile(overrides: Partial<Parameters<typeof compileAgentPromptContext>[0]> = {}) {
  return compileAgentPromptContext({
    executionEnvironment: buildAgentExecutionEnvironmentContext("E:\\senera"),
    toolCards: [],
    toolDiscoveryToolName: null,
    rootCommand: null,
    continuityMemory: EmptyAgentContinuityMemoryPromptContext,
    workflow: EmptyAgentWorkflowPromptContext,
    ...overrides,
  });
}
describe("agent prompt context compiler", () => {
  test("contains only supported layers", () => {
    expect(compile().ContextLayers).toEqual([
      { name: "kernel", source: "runtime", stability: "stable", included: true },
      { name: "persona", source: "runtime", stability: "stable", included: false },
      { name: "memory", source: "continuity", stability: "turn", included: false },
      { name: "workflow", source: "runtime", stability: "turn", included: false },
      { name: "task", source: "request", stability: "turn", included: false },
    ]);
  });
  test("request changes invalidate only the volatile revision", () => {
    const first = compile();
    const second = compile({ rootCommand: toolRootCommand() });
    expect(second.ContextRevisions.stable).toBe(first.ContextRevisions.stable);
    expect(second.ContextRevisions.context).toBe(first.ContextRevisions.context);
    expect(second.ContextRevisions.volatile).not.toBe(first.ContextRevisions.volatile);
  });
  test("native memory is selected for turn context without altering the stable provider prefix", () => {
    const first = compile();
    const memory = {
      ...EmptyAgentContinuityMemoryPromptContext,
      enabled: true,
      eventCandidates: [
        {
          id: "1",
          uri: "memos:1",
          revision: "v1",
          type: "preference" as const,
          summary: "先给结论",
          occurredAt: "2026-08-22T08:00:00Z",
          score: 0.9,
          matchedBy: ["memos"],
        },
      ],
    };
    const second = compile({ continuityMemory: memory });
    expect(second.ContextRevisions.stable).toBe(first.ContextRevisions.stable);
    expect(second.ContextRevisions.context).toBe(first.ContextRevisions.context);
    expect(second.ContinuityMemory).toBe(memory);
    expect(second.ContextLayers.find((layer) => layer.name === "memory")?.included).toBe(true);
  });
  test("persona and workflow change their own revisions", () => {
    const first = compile();
    const persona = compile({
      persona: { enabled: true, card: { markdown: "# 可靠的助手\n\n简洁" } },
    });
    expect(persona.ContextRevisions.stable).not.toBe(first.ContextRevisions.stable);
    const workflow = compile({
      workflow: {
        ...EmptyAgentWorkflowPromptContext,
        todos: {
          items: [
            {
              id: "1",
              content: "检查召回",
              status: "pending",
              order: 1,
              createdAt: "2026-08-22T08:00:00Z",
              updatedAt: "2026-08-22T08:00:00Z",
            },
          ],
          counts: { total: 1, pending: 1, inProgress: 0, completed: 0, cancelled: 0 },
        },
      },
    });
    expect(workflow.ContextRevisions.stable).toBe(first.ContextRevisions.stable);
    expect(workflow.ContextRevisions.volatile).not.toBe(first.ContextRevisions.volatile);
    expect(workflow.ContextLayers.find((layer) => layer.name === "workflow")?.included).toBe(true);
  });
});
