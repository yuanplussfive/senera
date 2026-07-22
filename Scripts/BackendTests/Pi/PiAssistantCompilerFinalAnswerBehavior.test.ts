import { describe, expect, test } from "vitest";
import {
  AgentPiAssistantCompiler,
  type AgentPiAssistantCompilerModelClient,
} from "../../../Source/AgentSystem/PiProxy/AgentPiAssistantCompiler.js";
import type {
  AgentPiControllerActionInput,
  AgentPiToolArgumentsInput,
  AgentPiToolArgumentsRepairInput,
} from "../../../Source/AgentSystem/PiProxy/AgentPiAssistantMessageTypes.js";
import { createModelProvider, createPlannerConfig } from "../Support/AgentTestFixtures.js";
import type { AgentRootCommand } from "../../../Source/AgentSystem/AgentRootCommand.js";
import { InteractionRunMode, TurnContextMode } from "../../../Source/AgentSystem/BamlClient/baml_client/types.js";
import { AgentPiPreparedActionLease } from "../../../Source/AgentSystem/PiProxy/AgentPiPreparedActionLease.js";

describe("Pi assistant final-answer compilation", () => {
  test("projects a validated FinalAnswer into a separate generation input", async () => {
    const client = new FinalAnswerCompilerClient({
      kind: "FinalAnswer",
      answerPlan: ["State the verified result.", "Mention the supporting observation."],
    });
    const compiler = createCompiler(client);

    const compilation = await compiler.compile({
      request: {
        model: "test-model",
        messages: [{ role: "user", content: "What was verified?" }],
      },
      runtime: {
        requestId: "request-final-answer",
        rootCommand: toolRootCommand(),
        activeSkills: [{ name: "analysis" }],
      },
    });

    expect(compilation).toMatchObject({
      kind: "final_answer",
      decisionSource: "model",
      input: {
        answerPlan: ["State the verified result.", "Mention the supporting observation."],
        openAiRequest: {
          model: "test-model",
          messages: [{ role: "user", content: "What was verified?" }],
        },
        seneraRuntime: {
          modelProviderId: "test-provider",
          model: "test-model",
          rootCommand: toolRootCommand(),
          activeSkills: [{ name: "analysis" }],
        },
      },
    });
    expect(client.repairRequests).toHaveLength(0);
  });

  test("skips duplicate action selection for an authoritative direct-response route", async () => {
    const client = new FinalAnswerCompilerClient(new Error("SelectPiAction should not run."));
    const compilation = await createCompiler(client).compile({
      request: {
        model: "test-model",
        messages: [{ role: "user", content: "Explain the current state." }],
        tools: [],
        tool_choice: "none",
      },
      runtime: {
        requestId: "request-direct-answer",
        rootCommand: answerRootCommand(),
        interactionRoute: directRoute(),
        turnUnderstanding: {
          rawUserTurn: "Explain the current state.",
          standaloneRequest: "Explain the current state.",
          contextMode: TurnContextMode.None,
          contextBasis: "",
          missingContext: "",
        },
      },
    });

    expect(client.selectInputs).toHaveLength(0);
    expect(compilation).toMatchObject({
      kind: "final_answer",
      decisionSource: "runtime",
      input: {
        answerPlan: ["Explain the current state from the conversation context."],
      },
    });
  });

  test("consumes a prepared action exactly once before returning to model selection", async () => {
    const client = new FinalAnswerCompilerClient({
      kind: "FinalAnswer",
      answerPlan: ["Use the model-selected fallback plan."],
    });
    const compiler = createCompiler(client);
    const preparedAction = new AgentPiPreparedActionLease({
      kind: "FinalAnswer",
      answerPlan: ["Use the prepared plan."],
    });
    const request = {
      request: {
        model: "test-model",
        messages: [{ role: "user" as const, content: "Summarize the state." }],
      },
      runtime: {
        requestId: "request-prepared-answer",
        rootCommand: toolRootCommand(),
        preparedAction,
      },
    };

    await expect(compiler.compile(request)).resolves.toMatchObject({
      kind: "final_answer",
      decisionSource: "preparation",
      input: { answerPlan: ["Use the prepared plan."] },
    });
    expect(client.selectInputs).toHaveLength(0);

    await expect(compiler.compile(request)).resolves.toMatchObject({
      kind: "final_answer",
      decisionSource: "model",
      input: { answerPlan: ["Use the model-selected fallback plan."] },
    });
    expect(client.selectInputs).toHaveLength(1);
  });

  test("falls back to model selection when a prepared action references an unavailable tool", async () => {
    const client = new FinalAnswerCompilerClient({
      kind: "FinalAnswer",
      answerPlan: ["Explain that the requested external lookup is unavailable."],
    });
    const compilation = await createCompiler(client).compile({
      request: {
        model: "test-model",
        messages: [{ role: "user", content: "Search the web." }],
        tools: [
          {
            type: "function",
            function: {
              name: "WorkspaceReadFile",
              description: "Read one workspace file.",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
      },
      runtime: {
        requestId: "request-stale-prepared-tool",
        rootCommand: toolRootCommand(),
        preparedAction: new AgentPiPreparedActionLease({
          kind: "CallTools",
          preface: "Searching the web.",
          calls: [
            {
              toolName: "TavilySearchTool",
              purpose: "Search current web sources.",
              required: true,
            },
          ],
        }),
      },
    });

    expect(client.selectInputs).toHaveLength(1);
    expect(compilation).toMatchObject({
      kind: "final_answer",
      decisionSource: "model",
    });
  });

  test("materializes schema-valid prepared tool calls without another model request", async () => {
    const client = new FinalAnswerCompilerClient(new Error("No model stage should run."));
    const compilation = await createCompiler(client).compile({
      request: {
        model: "test-model",
        messages: [{ role: "user", content: "Read package.json." }],
        tools: [
          {
            type: "function",
            function: {
              name: "WorkspaceReadFile",
              description: "Read one workspace file.",
              parameters: {
                type: "object",
                properties: { path: { type: "string" } },
                required: ["path"],
                additionalProperties: false,
              },
            },
          },
        ],
      },
      runtime: {
        requestId: "request-prepared-tool",
        rootCommand: toolRootCommand(),
        preparedAction: new AgentPiPreparedActionLease({
          kind: "CallTools",
          preface: "Reading the project manifest.",
          calls: [
            {
              toolName: "WorkspaceReadFile",
              purpose: "Read package.json.",
              required: true,
              argumentHints: { path: "package.json" },
            },
          ],
        }),
      },
    });

    expect(compilation).toMatchObject({
      kind: "tool_calls",
      content: "Reading the project manifest.",
      toolCalls: [{ name: "WorkspaceReadFile", arguments: { path: "package.json" } }],
    });
    expect(client.selectInputs).toHaveLength(0);
  });

  test("validates prepared arguments against the complete schema when its planning card is truncated", async () => {
    const client = new FinalAnswerCompilerClient(new Error("No model stage should run."));
    const compilation = await createCompiler(client).compile({
      request: {
        model: "test-model",
        messages: [{ role: "user", content: "Search for the current release." }],
        tools: [
          {
            type: "function",
            function: {
              name: "LargeSearchTool",
              description: "Search current external sources.",
              parameters: {
                type: "object",
                properties: {
                  query: { type: "string", description: "q".repeat(100_000) },
                },
                required: ["query"],
                additionalProperties: false,
              },
            },
          },
        ],
      },
      runtime: {
        requestId: "request-large-tool-schema",
        rootCommand: toolRootCommand(),
        preparedAction: new AgentPiPreparedActionLease({
          kind: "CallTools",
          preface: "Searching current sources.",
          calls: [
            {
              toolName: "LargeSearchTool",
              purpose: "Find the current release.",
              required: true,
              argumentHints: { query: "current release" },
            },
          ],
        }),
      },
    });

    expect(compilation).toMatchObject({
      kind: "tool_calls",
      toolCalls: [{ name: "LargeSearchTool", arguments: { query: "current release" } }],
    });
    expect(client.selectInputs).toHaveLength(0);
  });

  test("fills model-selected arguments from the complete schema after bounded tool planning", async () => {
    const client = new ToolArgumentCompilerClient();
    const compilation = await createCompiler(client).compile({
      request: {
        model: "test-model",
        messages: [{ role: "user", content: "Search for the current release." }],
        tools: [
          {
            type: "function",
            function: {
              name: "LargeSearchTool",
              description: "Search current external sources.",
              parameters: {
                type: "object",
                properties: {
                  query: { type: "string", description: "q".repeat(100_000) },
                },
                required: ["query"],
                additionalProperties: false,
              },
            },
          },
        ],
      },
      runtime: {
        requestId: "request-fill-large-tool-schema",
        rootCommand: toolRootCommand(),
      },
    });

    expect(compilation).toMatchObject({
      kind: "tool_calls",
      toolCalls: [{ name: "LargeSearchTool", arguments: { query: "current release" } }],
    });
    expect(client.selectInputs[0]?.candidateTools[0]?.parameterContract).toMatchObject({
      format: "json_schema_outline",
      rootTypes: ["object"],
      properties: [{ path: "query", types: ["string"], required: true }],
      omittedProperties: 0,
    });
    expect(client.fillInputs[0]?.tool.parameters).toMatchObject({
      type: "object",
      required: ["query"],
    });
  });

  test("repairs legacy FinalAnswer output that still contains user-visible answer text", async () => {
    const client = new FinalAnswerCompilerClient(
      {
        kind: "FinalAnswer",
        answer: "Legacy user-visible text.",
      },
      {
        kind: "FinalAnswer",
        answerPlan: ["Generate the answer from the conversation evidence."],
      },
    );

    const compilation = await createCompiler(client).compile({
      request: {
        model: "test-model",
        messages: [{ role: "user", content: "Answer from the evidence." }],
      },
    });

    expect(client.repairRequests).toHaveLength(1);
    expect(client.repairRequests[0]).toMatchObject({
      invalidAction: expect.stringContaining("Legacy user-visible text."),
    });
    expect(client.repairRequests[0]?.issues.join(" ")).toContain("answer");
    expect(compilation).toMatchObject({
      kind: "final_answer",
      input: {
        answerPlan: ["Generate the answer from the conversation evidence."],
      },
    });
  });

  test("projects one bounded tool catalog and keeps transcript observations index-only", async () => {
    const client = new FinalAnswerCompilerClient({
      kind: "FinalAnswer",
      answerPlan: ["Summarize the observed tool result."],
    });

    await createCompiler(client).compile({
      request: {
        model: "test-model",
        messages: [
          { role: "user", content: "Inspect the result." },
          {
            role: "assistant",
            content: "Checking.",
            tool_calls: [
              {
                id: "call-large",
                type: "function",
                function: { name: "LargeTool", arguments: '{"query":"status"}' },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "call-large",
            content: JSON.stringify({ status: "success", summary: "Complete", raw: "x".repeat(100_000) }),
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "LargeTool",
              description: "d".repeat(100_000),
              parameters: {
                type: "object",
                properties: {
                  query: { type: "string", description: "s".repeat(100_000) },
                },
              },
            },
          },
        ],
      },
    });

    const input = client.selectInputs[0];
    expect(input).toBeDefined();
    expect(input).not.toHaveProperty("allowedTools");
    expect(input?.openAiRequest).not.toHaveProperty("tools");
    expect(JSON.stringify(input?.candidateTools).length).toBeLessThan(12_000);
    expect(JSON.stringify(input?.candidateTools)).not.toContain("senera.token_preview.v1");
    expect(input?.candidateTools[0]?.parameterContract.format).toBe("json_schema_outline");
    expect(input?.openAiRequest.toolTranscript[0]?.observation).toEqual({
      status: "success",
      summary: "Complete",
      evidenceUris: [],
    });
  });
});

class FinalAnswerCompilerClient implements AgentPiAssistantCompilerModelClient {
  readonly selectInputs: AgentPiControllerActionInput[] = [];
  readonly repairRequests: Array<{
    input: AgentPiControllerActionInput;
    invalidAction: string;
    issues: string[];
  }> = [];

  constructor(
    private readonly selectedAction: unknown,
    private readonly repairedAction: unknown = selectedAction,
  ) {}

  async selectPiAction(input: AgentPiControllerActionInput): Promise<unknown> {
    this.selectInputs.push(input);
    return this.selectedAction;
  }

  async repairPiAction(request: {
    input: AgentPiControllerActionInput;
    invalidAction: string;
    issues: string[];
  }): Promise<unknown> {
    this.repairRequests.push(request);
    return this.repairedAction;
  }

  async fillPiToolArguments(_input: AgentPiToolArgumentsInput): Promise<never> {
    throw new Error("FinalAnswer compilation must not fill tool arguments.");
  }

  async repairPiToolArguments(_input: AgentPiToolArgumentsRepairInput): Promise<never> {
    throw new Error("FinalAnswer compilation must not repair tool arguments.");
  }
}

class ToolArgumentCompilerClient implements AgentPiAssistantCompilerModelClient {
  readonly selectInputs: AgentPiControllerActionInput[] = [];
  readonly fillInputs: AgentPiToolArgumentsInput[] = [];

  async selectPiAction(input: AgentPiControllerActionInput): Promise<unknown> {
    this.selectInputs.push(input);
    return {
      kind: "CallTools",
      preface: "Searching current sources.",
      calls: [
        {
          toolName: "LargeSearchTool",
          purpose: "Find the current release.",
          required: true,
        },
      ],
    };
  }

  async repairPiAction(): Promise<never> {
    throw new Error("The selected action should be valid.");
  }

  async fillPiToolArguments(input: AgentPiToolArgumentsInput): Promise<unknown> {
    this.fillInputs.push(input);
    return {
      arguments: { query: "current release" },
      missingInputs: [],
      assumptions: [],
    };
  }

  async repairPiToolArguments(): Promise<never> {
    throw new Error("The generated arguments should be valid.");
  }
}

function createCompiler(client: AgentPiAssistantCompilerModelClient): AgentPiAssistantCompiler {
  return new AgentPiAssistantCompiler({
    modelProvider: createModelProvider(),
    actionPlannerConfig: createPlannerConfig(),
    client,
  });
}

function toolRootCommand(): AgentRootCommand {
  return {
    authority: "senera_runtime_root",
    action: "use_tools",
    outputMode: "open",
    toolAccess: "restricted",
    objective: "Use tools when required.",
    instruction: "Inspect the requested state.",
    allowedTools: [],
    forbiddenOutputs: [],
    insufficiencyPolicy: "ask",
    preferredTools: [],
    toolSearchQueries: [],
    needs: [],
    includeToolCatalog: false,
    visibleOutput: {
      audience: "runtime",
      start: "",
      format: "text",
      rules: [],
      repair: { instruction: "", rules: [] },
    },
  };
}

function answerRootCommand(): AgentRootCommand {
  return {
    ...toolRootCommand(),
    action: "answer",
    objective: "Answer the user directly.",
    instruction: null,
  };
}

function directRoute() {
  return {
    mode: "direct_response" as const,
    objective: "Explain the current state from the conversation context.",
    preferredTools: [],
    discoveryQueries: [],
    raw: {
      mode: InteractionRunMode.DirectResponse,
      objective: "Explain the current state from the conversation context.",
      preferredTools: [],
      discoveryQueries: [],
    },
  };
}
