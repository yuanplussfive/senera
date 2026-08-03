import { describe, expect, test } from "vitest";
import {
  AgentPiAssistantCompiler,
  type AgentPiAssistantCompilerModelClient,
} from "../../../Source/AgentSystem/PiProxy/AgentPiAssistantCompiler.js";
import type {
  AgentPiControllerDecisionInput,
  AgentPiToolArgumentsInput,
  AgentPiToolArgumentsRepairInput,
} from "../../../Source/AgentSystem/PiProxy/AgentPiAssistantMessageTypes.js";
import { createModelProvider, toolAccessGrant } from "../Support/AgentTestFixtures.js";
import { createAgentToolAccessGrant } from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";

describe("Pi assistant controller compilation", () => {
  test("returns a complete Direct response from one controller model call", async () => {
    const client = new CompilerClient([{ kind: "Direct", response: "Dependency injection supplies dependencies." }]);

    const compilation = await createCompiler(client).compile({
      toolAccessGrant: toolAccessGrant(),
      request: {
        model: "test-model",
        messages: [{ role: "user", content: "Explain dependency injection." }],
      },
    });

    expect(compilation).toEqual({
      kind: "final_text",
      content: "Dependency injection supplies dependencies.",
      toolCalls: [],
    });
    expect(client.evolveInputs).toHaveLength(1);
    expect(client.fillInputs).toHaveLength(0);
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
      request: {
        model: "test-model",
        messages: [{ role: "user", content: "Search for the current release." }],
        tools: [tool("LargeSearchTool", parameters, "Search current external sources.")],
      },
    });

    expect(compilation).toMatchObject({
      kind: "tool_calls",
      toolCalls: [{ name: "LargeSearchTool", arguments: { query: "current release" } }],
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
      request: {
        model: "test-model",
        messages: [{ role: "user", content: "Use ToolB." }],
        tools: [
          tool("ToolB", { type: "object", properties: {} }),
          tool("ToolC", { type: "object", properties: {} }),
          tool("ToolA", { type: "object", properties: {} }),
        ],
      },
    });

    expect(client.evolveInputs[0]?.routingCards.map((card) => card.name)).toEqual(["ToolA", "ToolB", "ToolC"]);
    expect(compilation).toMatchObject({ kind: "tool_calls", toolCalls: [{ name: "ToolB" }] });
  });

  test("projects tools discovered earlier in the same turn from the live exposure generation", async () => {
    const client = new CompilerClient([{ kind: "Direct", response: "Weather is available." }]);
    const grant = createAgentToolAccessGrant({
      authorizedToolNames: ["ToolSearchTool", "WeatherTool"],
      exposedToolNames: ["ToolSearchTool"],
    });
    const toolExposure = new AgentToolExposureState(grant);
    toolExposure.expose(["WeatherTool"]);

    await createCompiler(client).compile({
      toolAccessGrant: grant,
      request: {
        model: "test-model",
        messages: [{ role: "user", content: "Find the weather tool, then use it." }],
        tools: [
          tool("ToolSearchTool", { type: "object", properties: {} }),
          tool("WeatherTool", { type: "object", properties: {} }),
        ],
      },
      runtime: { requestId: "request-live-exposure", toolExposure },
    });

    expect(client.evolveInputs[0]?.seneraRuntime.toolExposure.generation).toBe(1);
    expect(client.evolveInputs[0]?.routingCards.map((card) => card.name)).toEqual(["WeatherTool", "ToolSearchTool"]);
  });

  test("rejects request tools outside the authoritative access grant", async () => {
    const client = new CompilerClient([]);

    await expect(
      createCompiler(client).compile({
        toolAccessGrant: toolAccessGrant(["ToolA"]),
        request: {
          model: "test-model",
          messages: [{ role: "user", content: "Use a tool." }],
          tools: [tool("ToolA", { type: "object", properties: {} }), tool("ToolB", { type: "object", properties: {} })],
        },
      }),
    ).rejects.toThrow("ToolB");
    expect(client.evolveInputs).toHaveLength(0);
  });

  test("fills independent tool arguments concurrently", async () => {
    const client = new ConcurrentArgumentCompilerClient();
    const compiler = createCompiler(client);

    const compilation = await compiler.compile({
      toolAccessGrant: toolAccessGrant(["ReadFirst", "ReadSecond"], ["ReadFirst", "ReadSecond"]),
      request: {
        model: "test-model",
        messages: [{ role: "user", content: "Read both files." }],
        tools: [tool("ReadFirst", requiredPathSchema()), tool("ReadSecond", requiredPathSchema())],
      },
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
      request: { model: "test-model", messages: [{ role: "user", content: "Answer directly." }] },
    });

    expect(compilation).toEqual({ kind: "final_text", content: "No tool call is required.", toolCalls: [] });
    expect(client.repairRequests).toHaveLength(1);
    expect(client.fillInputs).toHaveLength(0);
  });
});

class CompilerClient implements AgentPiAssistantCompilerModelClient {
  readonly evolveInputs: AgentPiControllerDecisionInput[] = [];
  readonly fillInputs: AgentPiToolArgumentsInput[] = [];
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

  async evolveTurn(input: AgentPiControllerDecisionInput): Promise<unknown> {
    this.evolveInputs.push(input);
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

  async fillPiToolArguments(input: AgentPiToolArgumentsInput): Promise<unknown> {
    this.fillInputs.push(input);
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

function createCompiler(client: AgentPiAssistantCompilerModelClient): AgentPiAssistantCompiler {
  return new AgentPiAssistantCompiler({ modelProvider: createModelProvider(), client });
}

function tool(name: string, parameters: Record<string, unknown>, description = `${name} description`) {
  return {
    type: "function" as const,
    function: { name, description, parameters },
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
