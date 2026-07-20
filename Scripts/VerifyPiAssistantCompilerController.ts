import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import {
  AgentPiAssistantCompiler,
  type AgentPiAssistantCompileRequest,
  type AgentPiAssistantCompilerModelClient,
} from "../Source/AgentSystem/PiProxy/AgentPiAssistantCompiler.js";
import type {
  AgentPiControllerActionInput,
  AgentPiToolArgumentsInput,
  AgentPiToolArgumentsRepairInput,
} from "../Source/AgentSystem/PiProxy/AgentPiAssistantMessageTypes.js";
import type {
  ResolvedAgentActionPlannerConfig,
  ResolvedAgentModelProviderConfig,
} from "../Source/AgentSystem/Types/AgentConfigTypes.js";

async function main(): Promise<void> {
  await verifyLargeOpenAiMessagesAreBudgetedForPlanning();
  await verifyConcurrentReadyArgumentFilling();
  await verifyHintsAndArgumentRepair();
  await verifyToolChoiceRepairAndParallelFalse();
  await verifyAllowedToolChoiceSubset();
  await verifyDependentCallsWaitForFutureTurns();
  console.log("Pi assistant controller orchestration verified.");
}

async function verifyLargeOpenAiMessagesAreBudgetedForPlanning(): Promise<void> {
  const hugeToolResult = "search-result\n".repeat(260_000);
  const client = new FakePiCompilerClient({
    action: {
      kind: "FinalAnswer",
      answerPlan: ["Summarize completion."],
    },
  });

  const message = await compiler(client).compile({
    request: {
      ...requestWithTools(),
      messages: [
        {
          role: "user",
          content: "Inspect the project.",
        },
        {
          role: "assistant",
          content: "I will search files.",
          tool_calls: [
            {
              id: "call_search",
              type: "function",
              function: {
                name: "SearchTool",
                arguments: '{"query":"*"}',
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_search",
          content: hugeToolResult,
        },
      ],
    },
  });

  assert.equal(message.kind, "final_answer");
  if (message.kind !== "final_answer") throw new Error("Expected a final-answer generation plan.");
  assert.deepEqual(message.input.answerPlan, ["Summarize completion."]);
  const projected = JSON.stringify(client.selectInputs[0]?.openAiRequest.messages);
  assert.equal(projected.includes(hugeToolResult.slice(0, 200_000)), false);
  assert.equal(projected.includes("..."), true);
  assert.ok(projected.length < 32_000, `projected Pi planning messages should stay compact, got ${projected.length}`);
  const transcript = client.selectInputs[0]?.openAiRequest.toolTranscript ?? [];
  assert.equal(transcript[0]?.callId, "call_search");
  assert.equal(transcript[0]?.toolName, "SearchTool");
  assert.match(transcript[0]?.argumentsJson ?? "", /query/);
  assert.equal(transcript[0]?.observation?.status, "unknown");
}

async function verifyConcurrentReadyArgumentFilling(): Promise<void> {
  let inFlight = 0;
  let maxInFlight = 0;
  const client = new FakePiCompilerClient({
    action: {
      kind: "CallTools",
      preface: "Checking both sources.",
      calls: [
        {
          toolName: "SearchTool",
          purpose: "Search for the requested item.",
          required: true,
        },
        {
          toolName: "LookupTool",
          purpose: "Look up the requested item.",
          required: true,
        },
      ],
    },
    fill: async (input) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(25);
      inFlight -= 1;
      return {
        arguments: input.call.toolName === "SearchTool" ? { query: "status" } : { key: "status" },
        missingInputs: [],
        assumptions: [],
      };
    },
  });

  const message = await compiler(client).compile({
    request: requestWithTools(),
  });

  assert.equal(message.kind, "tool_calls");
  assert.equal(message.content, "Checking both sources.");
  assert.deepEqual(
    message.toolCalls.map((call) => call.name),
    ["SearchTool", "LookupTool"],
  );
  assert.match(message.toolCalls[0]?.id ?? "", /^call_[a-f0-9]{8}$/);
  assert.equal(maxInFlight, 2);
}

async function verifyHintsAndArgumentRepair(): Promise<void> {
  const client = new FakePiCompilerClient({
    action: {
      kind: "CallTools",
      preface: "Preparing tool inputs.",
      calls: [
        {
          toolName: "SearchTool",
          purpose: "Search directly from obvious user input.",
          required: true,
          argumentHints: {
            query: "status",
          },
        },
        {
          toolName: "LookupTool",
          purpose: "Look up a normalized key.",
          required: true,
        },
      ],
    },
    fill: () => ({
      arguments: {
        wrong: "value",
      },
      missingInputs: [],
      assumptions: [],
    }),
    repairArguments: () => ({
      arguments: {
        key: "status",
      },
      missingInputs: [],
      assumptions: [],
    }),
  });

  const message = await compiler(client).compile({
    request: requestWithTools(),
  });

  assert.equal(client.fillCalls.length, 1);
  assert.equal(client.repairArgumentCalls.length, 1);
  if (message.kind !== "tool_calls") throw new Error("Expected compiled tool calls.");
  assert.deepEqual(
    message.toolCalls.map((call) => call.arguments),
    [{ query: "status" }, { key: "status" }],
  );
}

async function verifyToolChoiceRepairAndParallelFalse(): Promise<void> {
  const client = new FakePiCompilerClient({
    action: {
      kind: "FinalAnswer",
      answerPlan: ["This violates forced tool choice."],
    },
    repairAction: {
      kind: "CallTools",
      preface: "Using the requested tool.",
      calls: [
        {
          toolName: "LookupTool",
          purpose: "Use the forced lookup tool.",
          required: true,
          argumentHints: {
            key: "status",
          },
        },
        {
          toolName: "LookupTool",
          purpose: "A second ready call that must be held back when parallel calls are disabled.",
          required: false,
          argumentHints: {
            key: "extra",
          },
        },
      ],
    },
  });

  const message = await compiler(client).compile({
    request: {
      ...requestWithTools(),
      tool_choice: {
        type: "function",
        function: {
          name: "LookupTool",
        },
      },
      parallel_tool_calls: false,
    },
  });

  assert.equal(client.repairActionCalls.length, 1);
  assert.deepEqual(
    client.selectInputs[0]?.candidateTools.map((tool) => tool.name),
    ["LookupTool"],
  );
  assert.equal(message.kind, "tool_calls");
  assert.deepEqual(
    message.toolCalls.map((call) => call.name),
    ["LookupTool"],
  );
  assert.deepEqual(
    message.toolCalls.map((call) => call.arguments),
    [{ key: "status" }],
  );
}

async function verifyAllowedToolChoiceSubset(): Promise<void> {
  const client = new FakePiCompilerClient({
    action: {
      kind: "CallTools",
      preface: "This first action uses a disallowed tool.",
      calls: [
        {
          toolName: "LookupTool",
          purpose: "The allowed_tools subset does not include this tool.",
          required: true,
          argumentHints: {
            key: "status",
          },
        },
      ],
    },
    repairAction: {
      kind: "CallTools",
      preface: "Using an allowed tool.",
      calls: [
        {
          toolName: "SearchTool",
          purpose: "Use the allowed search tool.",
          required: true,
          argumentHints: {
            query: "status",
          },
        },
      ],
    },
  });

  const message = await compiler(client).compile({
    request: {
      ...requestWithTools(),
      tool_choice: {
        type: "allowed_tools",
        allowed_tools: {
          mode: "required",
          tools: [
            {
              type: "function",
              function: {
                name: "SearchTool",
              },
            },
          ],
        },
      },
    },
  });

  assert.equal(client.repairActionCalls.length, 1);
  assert.deepEqual(
    client.selectInputs[0]?.candidateTools.map((tool) => tool.name),
    ["SearchTool"],
  );
  if (message.kind !== "tool_calls") throw new Error("Expected compiled tool calls.");
  assert.deepEqual(
    message.toolCalls.map((call) => call.name),
    ["SearchTool"],
  );
}

async function verifyDependentCallsWaitForFutureTurns(): Promise<void> {
  const client = new FakePiCompilerClient({
    action: {
      kind: "CallTools",
      preface: "Search first, then read after the result is available.",
      calls: [
        {
          toolName: "SearchTool",
          purpose: "Find the file.",
          required: true,
          argumentHints: {
            query: "config",
          },
        },
        {
          toolName: "LookupTool",
          purpose: "Use the search result.",
          required: true,
          dependsOn: [0],
          argumentHints: {
            key: "from-search",
          },
        },
      ],
    },
  });

  const message = await compiler(client).compile({
    request: requestWithTools(),
  });

  assert.equal(message.kind, "tool_calls");
  assert.deepEqual(
    message.toolCalls.map((call) => call.name),
    ["SearchTool"],
  );
}

class FakePiCompilerClient implements AgentPiAssistantCompilerModelClient {
  readonly selectInputs: AgentPiControllerActionInput[] = [];
  readonly fillCalls: AgentPiToolArgumentsInput[] = [];
  readonly repairActionCalls: Array<{
    input: AgentPiControllerActionInput;
    invalidAction: string;
    issues: string[];
  }> = [];
  readonly repairArgumentCalls: AgentPiToolArgumentsRepairInput[] = [];

  constructor(
    private readonly options: {
      action: unknown;
      repairAction?: unknown;
      fill?: (input: AgentPiToolArgumentsInput) => unknown | Promise<unknown>;
      repairArguments?: (input: AgentPiToolArgumentsRepairInput) => unknown | Promise<unknown>;
    },
  ) {}

  async selectPiAction(input: AgentPiControllerActionInput): Promise<unknown> {
    this.selectInputs.push(input);
    return this.options.action;
  }

  async repairPiAction(options: {
    input: AgentPiControllerActionInput;
    invalidAction: string;
    issues: string[];
  }): Promise<unknown> {
    this.repairActionCalls.push(options);
    return this.options.repairAction ?? this.options.action;
  }

  async fillPiToolArguments(input: AgentPiToolArgumentsInput): Promise<unknown> {
    this.fillCalls.push(input);
    return (
      this.options.fill?.(input) ?? {
        arguments: {},
        missingInputs: [],
        assumptions: [],
      }
    );
  }

  async repairPiToolArguments(input: AgentPiToolArgumentsRepairInput): Promise<unknown> {
    this.repairArgumentCalls.push(input);
    return (
      this.options.repairArguments?.(input) ?? {
        arguments: input.invalidArguments,
        missingInputs: [],
        assumptions: [],
      }
    );
  }
}

function compiler(client: AgentPiAssistantCompilerModelClient): AgentPiAssistantCompiler {
  return new AgentPiAssistantCompiler({
    modelProvider,
    actionPlannerConfig,
    client,
  });
}

function requestWithTools(): AgentPiAssistantCompileRequest["request"] {
  return {
    model: "test-model",
    messages: [
      {
        role: "user",
        content: "Check status.",
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "SearchTool",
          description: "Search by query.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
            required: ["query"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "LookupTool",
          description: "Look up by key.",
          parameters: {
            type: "object",
            properties: {
              key: { type: "string" },
            },
            required: ["key"],
            additionalProperties: false,
          },
        },
      },
    ],
  };
}

const modelProvider: ResolvedAgentModelProviderConfig = {
  Id: "test-model",
  ProviderId: "test-endpoint",
  Kind: "OpenAICompatible",
  Endpoint: "ChatCompletions",
  BaseUrl: "https://example.invalid/v1",
  ApiKey: "test-key",
  ApiVersion: "",
  Model: "test-model",
  Temperature: 0,
  MaxOutputTokens: -1,
  Stream: true,
  TimeoutMs: 20_000,
  FirstTokenTimeoutMs: 20_000,
  MaxRequestMs: 20_000,
  MaxNetworkRetries: 1,
  RetryBaseDelayMs: 250,
  RetryMaxDelayMs: 10_000,
  RetryAfterMaxDelayMs: 60_000,
  Headers: {},
  Capabilities: {},
};

const actionPlannerConfig: ResolvedAgentActionPlannerConfig = {
  Enabled: true,
  MaxRepairAttempts: 1,
  Evidence: {
    StalledStepLag: 2,
  },
  Client: {
    ModelProvider: modelProvider,
    BaseUrl: "https://example.invalid/v1",
    ApiKey: "test-key",
    Model: "test-model",
    Temperature: 0,
    MaxTokens: -1,
  },
  PlanningClient: {
    ModelProvider: modelProvider,
    BaseUrl: "https://example.invalid/v1",
    ApiKey: "test-key",
    Model: "test-model",
    Temperature: 0,
    MaxTokens: -1,
  },
  FinalAnswerClient: {
    ModelProvider: modelProvider,
    BaseUrl: "https://example.invalid/v1",
    ApiKey: "test-key",
    Model: "test-model",
    Temperature: 0,
    MaxTokens: -1,
  },
};

void main();
