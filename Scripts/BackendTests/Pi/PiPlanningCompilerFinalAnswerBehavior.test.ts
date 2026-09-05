import { describe, expect, test } from "vitest";
import {
  AgentPiPlanningCompiler,
  type AgentPiPlanningModelClient,
} from "../../../Source/AgentSystem/Pi/AgentPiPlanningCompiler.js";
import type { AgentLanguageModelInvocationOptions } from "../../../Source/AgentSystem/ModelEndpoints/AgentLanguageModel.js";
import type {
  AgentPiControllerDecisionInput,
  AgentPiToolArgumentsInput,
  AgentPiToolArgumentsRepairInput,
} from "../../../Source/AgentSystem/PiShared/AgentPiPlanningTypes.js";
import { createModelProvider, toolAccessGrant, toolRootCommand } from "../Support/AgentTestFixtures.js";
import { createAgentToolAccessGrant } from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";
import { projectSeneraModelProviderToPi } from "../../../Source/AgentSystem/Pi/AgentPiModelProjector.js";
import { AgentTurnTokenBudget } from "../../../Source/AgentSystem/Text/AgentTurnTokenBudget.js";

describe("Pi assistant controller compilation", () => {
  test("returns a complete Direct response from one controller model call", async () => {
    const client = new CompilerClient([{ kind: "Direct", response: "Dependency injection supplies dependencies." }]);

    const compilation = await createCompiler(client).compile({
      toolAccessGrant: toolAccessGrant(),
      ...planningRequest("Explain dependency injection."),
    });

    expect(compilation).toEqual({
      kind: "final_text",
      content: "Dependency injection supplies dependencies.",
      toolCalls: [],
    });
    expect(client.evolveInputs).toHaveLength(1);
    expect(client.fillInputs).toHaveLength(0);
  });

  test("keeps RootCommand in structured runtime data instead of duplicating it in the BAML system prompt", async () => {
    const client = new CompilerClient([{ kind: "Direct", response: "Done." }]);
    const rootCommand = {
      ...toolRootCommand(),
      objective: "STRUCTURED ROOT POLICY",
    };
    const request = planningRequest("Complete the task.");

    await createCompiler(client).compile({
      ...request,
      context: {
        ...request.context,
        systemPrompt: "<agent_system>BAML semantic guidance</agent_system>",
      },
      toolAccessGrant: rootCommand.toolAccessGrant,
      runtime: { rootCommand },
    });

    expect(client.evolveInputs[0]?.planningContext.systemPrompt).toBe(
      "<agent_system>BAML semantic guidance</agent_system>",
    );
    expect(client.evolveInputs[0]?.planningContext.systemPrompt).not.toContain("STRUCTURED ROOT POLICY");
    expect(client.evolveInputs[0]?.seneraRuntime.rootCommand).toEqual(rootCommand);
  });

  test("loads the authoritative schema only after tool selection", async () => {
    const parameters = {
      type: "object",
      properties: { query: { type: "string", description: "q".repeat(100_000) } },
      required: ["query"],
      additionalProperties: false,
    };
    const client = new CompilerClient([
      {
        kind: "Execute",
        fragment: {
          preface: "Searching current sources.",
          calls: [{ toolName: "LargeSearchTool", purpose: "Find the current release.", required: true }],
        },
      },
    ]);
    client.argumentResults.set("LargeSearchTool", {
      arguments: { query: "current release" },
      missingInputs: [],
      assumptions: [],
    });

    const compilation = await createCompiler(client).compile({
      toolAccessGrant: toolAccessGrant(["LargeSearchTool"], ["LargeSearchTool"]),
      ...planningRequest("Search for the current release.", [
        tool("LargeSearchTool", parameters, "Search current external sources."),
      ]),
    });

    expect(compilation).toMatchObject({
      kind: "tool_calls",
      toolCalls: [
        {
          name: "LargeSearchTool",
          arguments: { query: "current release" },
          purpose: "Find the current release.",
        },
      ],
    });
    expect(client.evolveInputs[0]?.routingCards).toEqual([
      expect.objectContaining({
        name: "LargeSearchTool",
        inputs: ["arguments.query: string (required)"],
      }),
    ]);
    expect(client.evolveInputs[0]?.routingCards[0]).not.toHaveProperty("parameterContract");
    expect(client.fillInputs[0]?.tool.parameters).toEqual(parameters);
  });

  test("orders preferred tools first without excluding another granted tool", async () => {
    const client = new CompilerClient([
      {
        kind: "Execute",
        fragment: {
          preface: "Using the best available tool.",
          calls: [{ toolName: "ToolB", purpose: "Use the non-preferred granted tool.", required: true }],
        },
      },
    ]);

    const compilation = await createCompiler(client).compile({
      toolAccessGrant: toolAccessGrant(["ToolA", "ToolB", "ToolC"], ["ToolA"]),
      ...planningRequest("Use ToolB.", [
        tool("ToolB", { type: "object", properties: {} }),
        tool("ToolC", { type: "object", properties: {} }),
        tool("ToolA", { type: "object", properties: {} }),
      ]),
    });

    expect(client.evolveInputs[0]?.routingCards.map((card) => card.name)).toEqual(["ToolA", "ToolB", "ToolC"]);
    expect(compilation).toMatchObject({ kind: "tool_calls", toolCalls: [{ name: "ToolB" }] });
  });

  test("projects tools discovered earlier in the same turn from the live exposure generation", async () => {
    const client = new CompilerClient([{ kind: "Direct", response: "Weather is available." }]);
    const grant = createAgentToolAccessGrant({
      authorizedToolNames: ["ToolSearch", "WeatherTool"],
      exposedToolNames: ["ToolSearch"],
    });
    const toolExposure = new AgentToolExposureState(grant);
    toolExposure.expose(["WeatherTool"]);

    await createCompiler(client).compile({
      toolAccessGrant: grant,
      ...planningRequest("Find the weather tool, then use it.", [
        tool("ToolSearch", { type: "object", properties: {} }),
        tool("WeatherTool", { type: "object", properties: {} }),
      ]),
      runtime: { requestId: "request-live-exposure", toolExposure },
    });

    expect(client.evolveInputs[0]?.seneraRuntime.toolExposure.generation).toBe(1);
    expect(client.evolveInputs[0]?.routingCards.map((card) => card.name)).toEqual(["WeatherTool", "ToolSearch"]);
  });

  test("rejects request tools outside the authoritative access grant", async () => {
    const client = new CompilerClient([]);

    await expect(
      createCompiler(client).compile({
        toolAccessGrant: toolAccessGrant(["ToolA"]),
        ...planningRequest("Use a tool.", [
          tool("ToolA", { type: "object", properties: {} }),
          tool("ToolB", { type: "object", properties: {} }),
        ]),
      }),
    ).rejects.toThrow("ToolB");
    expect(client.evolveInputs).toHaveLength(0);
  });

  test("fills independent tool arguments concurrently", async () => {
    const client = new ConcurrentArgumentCompilerClient();
    const compiler = createCompiler(client);

    const compilation = await compiler.compile({
      toolAccessGrant: toolAccessGrant(["ReadFirst", "ReadSecond"], ["ReadFirst", "ReadSecond"]),
      ...planningRequest("Read both files.", [
        tool("ReadFirst", requiredPathSchema()),
        tool("ReadSecond", requiredPathSchema()),
      ]),
    });

    expect(compilation.kind).toBe("tool_calls");
    expect(client.maximumConcurrentFills).toBe(2);
  });

  test("repairs an invalid controller decision before any tool is dispatched", async () => {
    const client = new CompilerClient([{ kind: "Execute", fragment: { preface: "Invalid.", calls: [] } }], {
      kind: "Direct",
      response: "No tool call is required.",
    });

    const compilation = await createCompiler(client).compile({
      toolAccessGrant: toolAccessGrant(),
      ...planningRequest("Answer directly."),
    });

    expect(compilation).toEqual({ kind: "final_text", content: "No tool call is required.", toolCalls: [] });
    expect(client.repairRequests).toHaveLength(1);
    expect(client.fillInputs).toHaveLength(0);
  });

  test("keeps ImageAnalyze selectable when the planner receives a native image", async () => {
    const client = new CompilerClient([
      {
        kind: "Execute",
        fragment: {
          preface: "Inspecting the screenshot with the image tool.",
          calls: [{ toolName: "ImageAnalyze", purpose: "Extract the requested visible detail.", required: true }],
        },
      },
    ]);
    client.supportsVisualInput = true;
    client.argumentResults.set("ImageAnalyze", {
      arguments: { resourceUri: "senera://resource/upl_image", task: "question", question: "What error is shown?" },
      missingInputs: [],
      assumptions: [],
    });
    const request = planningRequest("What error is shown in this screenshot?", [
      tool("ImageAnalyze", {
        type: "object",
        properties: {
          resourceUri: { type: "string" },
          task: { type: "string" },
          question: { type: "string" },
        },
        required: ["resourceUri"],
        additionalProperties: false,
      }),
    ]);
    const image = { type: "image" as const, data: "aW1hZ2U=", mimeType: "image/png" };

    const compilation = await createCompiler(client).compile({
      ...request,
      model: { ...request.model, input: ["text", "image"] },
      context: {
        ...request.context,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "What error is shown in this screenshot?" }, image],
            timestamp: 1,
          },
        ],
      },
      toolAccessGrant: toolAccessGrant(["ImageAnalyze"], ["ImageAnalyze"]),
    });

    expect(compilation).toMatchObject({ kind: "tool_calls", toolCalls: [{ name: "ImageAnalyze" }] });
    expect(client.evolveOptions[0]?.attachments).toEqual([image]);
    expect(client.fillOptions[0]?.attachments).toEqual([image]);
  });

  test("rebases the planning projection when the final planner envelope needs extra capacity", async () => {
    const modelProvider = createModelProvider({
      ContextWindowTokens: 4_096,
      MaxModelOutputTokens: 1_024,
    });
    const client = new CompilerClient([{ kind: "Direct", response: "Done." }]);
    const context = {
      messages: [
        ...Array.from({ length: 32 }, (_, index) => ({
          role: "user" as const,
          content: `history-${index} ${"context ".repeat(120)}`,
          timestamp: index + 1,
        })),
        { role: "user" as const, content: "latest request", timestamp: 100 },
      ],
      tools: [],
    };
    const tokenBudget = new AgentTurnTokenBudget({
      model: modelProvider.Model,
      contextWindowTokens: modelProvider.ContextWindowTokens,
      outputReserveTokens: modelProvider.MaxModelOutputTokens ?? 0,
    });

    await expect(
      new AgentPiPlanningCompiler({ modelProvider, client }).compile({
        model: projectSeneraModelProviderToPi(modelProvider).model,
        context,
        toolAccessGrant: toolAccessGrant(),
        runtime: { tokenBudget },
      }),
    ).resolves.toMatchObject({ kind: "final_text", content: "Done." });

    expect(client.evolveInputs[0]?.planningContext.projection.omittedOlderMessages).toBeGreaterThan(0);
    expect(tokenBudget.snapshot().occupiedTokens).toBeLessThanOrEqual(tokenBudget.snapshot().inputCapacityTokens);
  });
});

class CompilerClient implements AgentPiPlanningModelClient {
  supportsVisualInput: boolean | undefined;
  readonly evolveInputs: AgentPiControllerDecisionInput[] = [];
  readonly evolveOptions: AgentLanguageModelInvocationOptions[] = [];
  readonly fillInputs: AgentPiToolArgumentsInput[] = [];
  readonly fillOptions: AgentLanguageModelInvocationOptions[] = [];
  readonly repairRequests: Array<{
    input: AgentPiControllerDecisionInput;
    invalidDecision: string;
    issues: string[];
  }> = [];
  readonly argumentResults = new Map<string, unknown>();

  constructor(
    private readonly decisions: unknown[],
    private readonly repairedDecision: unknown = decisions.at(-1),
  ) {}

  async evolveTurn(
    input: AgentPiControllerDecisionInput,
    options?: AgentLanguageModelInvocationOptions,
  ): Promise<unknown> {
    this.evolveInputs.push(input);
    this.evolveOptions.push(options ?? {});
    const decision = this.decisions.shift();
    if (decision === undefined) throw new Error("Unexpected turn evolution.");
    return decision;
  }

  async repairControllerDecision(request: {
    input: AgentPiControllerDecisionInput;
    invalidDecision: string;
    issues: string[];
  }): Promise<unknown> {
    this.repairRequests.push(request);
    return this.repairedDecision;
  }

  async fillPiToolArguments(
    input: AgentPiToolArgumentsInput,
    options?: AgentLanguageModelInvocationOptions,
  ): Promise<unknown> {
    this.fillInputs.push(input);
    this.fillOptions.push(options ?? {});
    return (
      this.argumentResults.get(input.call.toolName) ?? {
        arguments: {},
        missingInputs: [],
        assumptions: [],
      }
    );
  }

  async repairPiToolArguments(_input: AgentPiToolArgumentsRepairInput): Promise<never> {
    throw new Error("Unexpected argument repair.");
  }

  async summarizePiConversation(): Promise<never> {
    throw new Error("Unexpected conversation summary.");
  }
}

class ConcurrentArgumentCompilerClient extends CompilerClient {
  private activeFills = 0;
  maximumConcurrentFills = 0;

  constructor() {
    super([
      {
        kind: "Execute",
        fragment: {
          preface: "Reading both files.",
          calls: [
            { toolName: "ReadFirst", purpose: "Read the first file.", required: true },
            { toolName: "ReadSecond", purpose: "Read the second file.", required: true },
          ],
        },
      },
    ]);
  }

  override async fillPiToolArguments(input: AgentPiToolArgumentsInput): Promise<unknown> {
    this.activeFills += 1;
    this.maximumConcurrentFills = Math.max(this.maximumConcurrentFills, this.activeFills);
    await new Promise((resolve) => setTimeout(resolve, 0));
    this.activeFills -= 1;
    return {
      arguments: { path: input.call.toolName === "ReadFirst" ? "first.txt" : "second.txt" },
      missingInputs: [],
      assumptions: [],
    };
  }
}

function createCompiler(
  client: AgentPiPlanningModelClient,
  modelProvider = createModelProvider(),
): AgentPiPlanningCompiler {
  return new AgentPiPlanningCompiler({ modelProvider, client });
}

function tool(name: string, parameters: Record<string, unknown>, description = `${name} description`) {
  return {
    name,
    description,
    parameters,
  };
}

function planningRequest(content: string, tools = [] as ReturnType<typeof tool>[]) {
  const modelProvider = createModelProvider({
    Model: "test-model",
    MaxModelOutputTokens: 1_024,
  });
  return {
    model: projectSeneraModelProviderToPi(modelProvider).model,
    context: {
      messages: [{ role: "user" as const, content, timestamp: 1 }],
      tools,
    },
  };
}

function requiredPathSchema() {
  return {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
    additionalProperties: false,
  };
}
