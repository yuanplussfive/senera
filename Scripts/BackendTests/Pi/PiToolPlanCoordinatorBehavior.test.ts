import { describe, expect, test, vi } from "vitest";
import {
  AgentPiAssistantCompiler,
  type AgentPiAssistantCompilerModelClient,
} from "../../../Source/AgentSystem/PiProxy/AgentPiAssistantCompiler.js";
import type {
  AgentPiToolArgumentsInput,
  AgentPiToolArgumentsRepairInput,
} from "../../../Source/AgentSystem/PiProxy/AgentPiAssistantMessageTypes.js";
import {
  AgentPiToolPlanCoordinator,
  AgentPiToolPlanNodeStatuses,
} from "../../../Source/AgentSystem/PiShared/AgentPiToolPlanCoordinator.js";
import { createModelProvider, toolAccessGrant } from "../Support/AgentTestFixtures.js";
import { compilePiToolObservation } from "../Support/PiToolObservationFixtures.js";
import { validateAgentPiCompletion } from "../../../Source/AgentSystem/PiProxy/AgentPiCompletionGate.js";

describe("Pi tool plan coordination", () => {
  test("does not release descendants while a prerequisite is waiting for user input", () => {
    const toolPlan = new AgentPiToolPlanCoordinator();
    toolPlan.accept("Collect input.", [
      { toolName: "AskTool", purpose: "Ask for the missing value.", required: true },
      { toolName: "UseTool", purpose: "Use the supplied value.", required: true, dependsOn: [0] },
    ]);
    const [ready] = toolPlan.ready();
    toolPlan.dispatch(ready!.nodeId, "call-ask");
    toolPlan.reconcile([
      {
        callId: "call-ask",
        toolName: "AskTool",
        argumentsJson: "{}",
        observation: {
          status: "waiting",
          outputAvailability: "none",
          summary: "Which value?",
          evidenceUris: [],
        },
      },
    ]);

    expect(toolPlan.ready()).toEqual([]);
    expect(toolPlan.snapshot().map((node) => node.status)).toEqual([
      AgentPiToolPlanNodeStatuses.Dispatched,
      AgentPiToolPlanNodeStatuses.Planned,
    ]);
  });

  test("does not treat an unknown observation as successful reconciliation", () => {
    const toolPlan = new AgentPiToolPlanCoordinator();
    toolPlan.accept("Inspect the source.", [
      { toolName: "SearchTool", purpose: "Inspect the source.", required: true },
    ]);
    const ready = toolPlan.ready().at(0);
    if (!ready) throw new Error("Expected a ready tool plan node.");
    toolPlan.dispatch(ready.nodeId, "call-unknown");
    toolPlan.reconcile([
      {
        callId: "call-unknown",
        toolName: "SearchTool",
        argumentsJson: "{}",
        observation: { status: "unknown", outputAvailability: "none", evidenceUris: [] },
      },
    ]);

    expect(toolPlan.hasUnreconciledCalls()).toBe(true);
    expect(toolPlan.snapshot()[0]?.status).toBe(AgentPiToolPlanNodeStatuses.Dispatched);
    expect(validateAgentPiCompletion({ kind: "Direct", response: "Done." }, toolPlan)).not.toEqual([]);
  });

  test("releases a dependent call when a failed prerequisite still exposes consumable output", () => {
    const toolPlan = new AgentPiToolPlanCoordinator();
    toolPlan.accept("Inspect and interpret the command output.", [
      { toolName: "ShellTool", purpose: "Run the diagnostic command.", required: true },
      { toolName: "InterpretTool", purpose: "Interpret any available output.", required: true, dependsOn: [0] },
    ]);
    const ready = toolPlan.ready().at(0);
    if (!ready) throw new Error("Expected a ready tool plan node.");
    toolPlan.dispatch(ready.nodeId, "call-diagnostic");

    toolPlan.reconcile([
      {
        callId: "call-diagnostic",
        toolName: "ShellTool",
        argumentsJson: "{}",
        observation: {
          status: "failure",
          outputAvailability: "partial",
          summary: "The process exited after producing diagnostics.",
          evidenceUris: [],
        },
      },
    ]);

    expect(toolPlan.snapshot()).toEqual([
      expect.objectContaining({
        status: AgentPiToolPlanNodeStatuses.Completed,
        assessment: "failure",
        failure: "The process exited after producing diagnostics.",
      }),
      expect.objectContaining({ status: AgentPiToolPlanNodeStatuses.Planned }),
    ]);
    expect(toolPlan.ready()).toEqual([
      expect.objectContaining({ call: expect.objectContaining({ toolName: "InterpretTool" }) }),
    ]);
  });

  test("releases a dependent call after both predecessors complete without selecting another action", async () => {
    const client = new PlannedCompilerClient();
    const compiler = createCompiler(client);
    const toolPlan = new AgentPiToolPlanCoordinator();
    const first = await compiler.compile({
      request: requestWithTranscript([]),
      toolAccessGrant: planToolAccessGrant(),
      runtime: { toolPlan },
    });

    expect(first).toMatchObject({
      kind: "tool_calls",
      toolCalls: [{ name: "SearchTool" }, { name: "LookupTool" }],
    });
    if (first.kind !== "tool_calls") throw new Error("Expected the first tool wave.");

    const second = await compiler.compile({
      request: requestWithTranscript(
        first.toolCalls.map((call) => ({
          id: call.id!,
          name: call.name,
          arguments: call.arguments,
          status: "success",
        })),
      ),
      toolAccessGrant: planToolAccessGrant(),
      runtime: { toolPlan },
    });

    expect(second).toMatchObject({
      kind: "tool_calls",
      content: "",
      toolCalls: [{ name: "MergeTool", arguments: { sources: ["search", "lookup"] } }],
    });
    expect(client.evolveTurn).toHaveBeenCalledTimes(1);
    expect(toolPlan.snapshot().map((node) => node.status)).toEqual([
      AgentPiToolPlanNodeStatuses.Completed,
      AgentPiToolPlanNodeStatuses.Completed,
      AgentPiToolPlanNodeStatuses.Dispatched,
    ]);
  });

  test("blocks descendants of a failed call while preserving an independent successful call", async () => {
    const client = new PlannedCompilerClient({
      fallbackAction: {
        kind: "Direct",
        response: "The prerequisite failed.",
      },
    });
    const compiler = createCompiler(client);
    const toolPlan = new AgentPiToolPlanCoordinator();
    const first = await compiler.compile({
      request: requestWithTranscript([]),
      toolAccessGrant: planToolAccessGrant(),
      runtime: { toolPlan },
    });
    if (first.kind !== "tool_calls") throw new Error("Expected the first tool wave.");

    const [failed, succeeded] = first.toolCalls;
    const second = await compiler.compile({
      request: requestWithTranscript([
        {
          id: failed!.id!,
          name: failed!.name,
          arguments: failed!.arguments,
          status: "failure",
        },
        {
          id: succeeded!.id!,
          name: succeeded!.name,
          arguments: succeeded!.arguments,
          status: "success",
        },
      ]),
      toolAccessGrant: planToolAccessGrant(),
      runtime: { toolPlan },
    });

    expect(second).toMatchObject({ kind: "final_text", content: "The prerequisite failed." });
    expect(client.evolveTurn).toHaveBeenCalledTimes(2);
    expect(toolPlan.snapshot().map((node) => node.status)).toEqual([
      AgentPiToolPlanNodeStatuses.Failed,
      AgentPiToolPlanNodeStatuses.Completed,
      AgentPiToolPlanNodeStatuses.Blocked,
    ]);
  });

  test("does not mark valid siblings as dispatched when a required call fails argument materialization", async () => {
    const client: AgentPiAssistantCompilerModelClient = {
      evolveTurn: async () => ({
        kind: "Execute",
        fragment: {
          preface: "Preparing a required batch.",
          calls: [
            {
              toolName: "SearchTool",
              purpose: "Prepare the valid sibling.",
              required: true,
            },
            {
              toolName: "LookupTool",
              purpose: "Prepare the invalid sibling.",
              required: true,
            },
            {
              toolName: "MergeTool",
              purpose: "Use both siblings.",
              required: true,
              dependsOn: [0, 1],
            },
          ],
        },
      }),
      repairControllerDecision: async () => {
        throw new Error("The action should be valid.");
      },
      fillPiToolArguments: async () => ({ arguments: {}, missingInputs: ["key"], assumptions: [] }),
      repairPiToolArguments: async () => ({ arguments: {}, missingInputs: ["key"], assumptions: [] }),
    };
    const toolPlan = new AgentPiToolPlanCoordinator();

    const compilation = await createCompiler(client).compile({
      request: requestWithTranscript([]),
      toolAccessGrant: planToolAccessGrant(),
      runtime: { toolPlan },
    });

    expect(compilation).toMatchObject({ kind: "final_text", toolCalls: [] });
    expect(toolPlan.snapshot().map((node) => node.status)).toEqual([
      AgentPiToolPlanNodeStatuses.Failed,
      AgentPiToolPlanNodeStatuses.Failed,
      AgentPiToolPlanNodeStatuses.Blocked,
    ]);
  });
});

function planToolAccessGrant() {
  const tools = ["SearchTool", "LookupTool", "MergeTool"];
  return toolAccessGrant(tools, tools);
}

class PlannedCompilerClient implements AgentPiAssistantCompilerModelClient {
  readonly evolveTurn = vi.fn(async () => {
    const call = this.evolveTurn.mock.calls.length;
    return call === 1 ? plannedAction() : this.options.fallbackAction;
  });

  constructor(
    private readonly options: {
      fallbackAction?: unknown;
    } = {},
  ) {}

  async repairControllerDecision(): Promise<never> {
    throw new Error("The planned action should be valid.");
  }

  async fillPiToolArguments(input: AgentPiToolArgumentsInput): Promise<unknown> {
    const argumentsByTool: Record<string, Record<string, unknown>> = {
      SearchTool: { query: "status" },
      LookupTool: { key: "status" },
      MergeTool: { sources: ["search", "lookup"] },
    };
    return { arguments: argumentsByTool[input.call.toolName] ?? {}, missingInputs: [], assumptions: [] };
  }

  async repairPiToolArguments(_input: AgentPiToolArgumentsRepairInput): Promise<never> {
    throw new Error("All test calls provide valid argument hints.");
  }
}

function plannedAction(): unknown {
  return {
    kind: "Execute",
    fragment: {
      preface: "Collecting independent inputs.",
      calls: [
        {
          toolName: "SearchTool",
          purpose: "Find the first input.",
          required: true,
        },
        {
          toolName: "LookupTool",
          purpose: "Find the second input.",
          required: true,
        },
        {
          toolName: "MergeTool",
          purpose: "Combine both inputs.",
          required: true,
          dependsOn: [0, 1],
        },
      ],
    },
  };
}

function requestWithTranscript(
  completed: readonly {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    status: "success" | "failure";
  }[],
) {
  return {
    model: "test-model",
    messages: [
      { role: "user" as const, content: "Collect and combine the status." },
      ...completed.flatMap((call) => [
        {
          role: "assistant" as const,
          content: null,
          tool_calls: [
            {
              id: call.id,
              type: "function" as const,
              function: { name: call.name, arguments: JSON.stringify(call.arguments) },
            },
          ],
        },
        {
          role: "tool" as const,
          tool_call_id: call.id,
          content: JSON.stringify(
            compilePiToolObservation({
              callId: call.id,
              toolName: call.name,
              status: call.status,
              outputAvailability: call.status === "success" ? "complete" : "none",
              summary: `${call.name} ${call.status}`,
              result: {},
            }),
          ),
        },
      ]),
    ],
    tools: [
      tool(
        "SearchTool",
        {
          query: { type: "string" },
        },
        ["query"],
      ),
      tool(
        "LookupTool",
        {
          key: { type: "string" },
        },
        ["key"],
      ),
      tool(
        "MergeTool",
        {
          sources: { type: "array", items: { type: "string" } },
        },
        ["sources"],
      ),
    ],
  };
}

function tool(name: string, properties: Record<string, unknown>, required: string[]) {
  return {
    type: "function" as const,
    function: {
      name,
      description: `${name} description.`,
      parameters: {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      },
    },
  };
}

function createCompiler(client: AgentPiAssistantCompilerModelClient): AgentPiAssistantCompiler {
  return new AgentPiAssistantCompiler({
    modelProvider: createModelProvider(),
    client,
  });
}
