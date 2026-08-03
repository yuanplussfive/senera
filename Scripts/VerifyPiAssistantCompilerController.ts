import assert from "node:assert/strict";
import {
  AgentPiAssistantCompiler,
  type AgentPiAssistantCompilerModelClient,
} from "../Source/AgentSystem/PiProxy/AgentPiAssistantCompiler.js";
import type {
  AgentPiControllerDecisionInput,
  AgentPiToolArgumentsInput,
  AgentPiToolArgumentsRepairInput,
} from "../Source/AgentSystem/PiProxy/AgentPiAssistantMessageTypes.js";
import type { ResolvedAgentModelProviderConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import {
  createAgentToolAccessGrant,
  emptyAgentToolAccessGrant,
} from "../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";

class VerificationClient implements AgentPiAssistantCompilerModelClient {
  readonly evolveInputs: AgentPiControllerDecisionInput[] = [];
  readonly fillInputs: AgentPiToolArgumentsInput[] = [];

  constructor(private readonly decisions: unknown[]) {}

  async evolveTurn(input: AgentPiControllerDecisionInput): Promise<unknown> {
    this.evolveInputs.push(input);
    const decision = this.decisions.shift();
    if (decision === undefined) throw new Error("No verification decision remains.");
    return decision;
  }

  async repairControllerDecision(): Promise<never> {
    throw new Error("Verification decisions must be valid.");
  }

  async fillPiToolArguments(input: AgentPiToolArgumentsInput): Promise<unknown> {
    this.fillInputs.push(input);
    return { arguments: { path: "package.json" }, missingInputs: [], assumptions: [] };
  }

  async repairPiToolArguments(_input: AgentPiToolArgumentsRepairInput): Promise<never> {
    throw new Error("Verification arguments must be valid.");
  }
}

async function main(): Promise<void> {
  const client = new VerificationClient([
    { kind: "Direct", response: "The turn is complete." },
    {
      kind: "Execute",
      fragment: {
        preface: "Inspecting the workspace.",
        calls: [{ toolName: "WorkspaceReadFile", purpose: "Read package.json.", required: true }],
      },
    },
  ]);
  const compiler = new AgentPiAssistantCompiler({ modelProvider: modelProvider(), client });

  const direct = await compiler.compile({
    toolAccessGrant: emptyAgentToolAccessGrant(),
    request: {
      model: "verification-model",
      messages: [{ role: "user", content: "Summarize." }],
      tools: [],
      tool_choice: "none",
    },
  });
  assert.deepEqual(direct, { kind: "final_text", content: "The turn is complete.", toolCalls: [] });

  const executed = await compiler.compile({
    toolAccessGrant: createAgentToolAccessGrant({
      authorizedToolNames: ["WorkspaceReadFile"],
      exposedToolNames: ["WorkspaceReadFile"],
      preferredToolNames: ["WorkspaceReadFile"],
    }),
    request: {
      model: "verification-model",
      messages: [{ role: "user", content: "Read package.json." }],
      tools: [
        {
          type: "function",
          function: {
            name: "WorkspaceReadFile",
            description: "Read a workspace file.",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "WorkspaceReadFile" } },
    },
  });
  assert.equal(executed.kind, "tool_calls");
  assert.deepEqual(
    executed.toolCalls.map((call) => [call.name, call.arguments]),
    [["WorkspaceReadFile", { path: "package.json" }]],
  );
  assert.equal("parameterContract" in client.evolveInputs[1]!.routingCards[0]!, false);
  assert.deepEqual(client.fillInputs[0]!.tool.parameters, {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
    additionalProperties: false,
  });

  process.stdout.write("Pi assistant controller verification passed.\n");
}

function modelProvider(): ResolvedAgentModelProviderConfig {
  return {
    Id: "verification",
    ProviderId: "verification",
    Kind: "OpenAICompatible",
    Endpoint: "ChatCompletions",
    BaseUrl: "http://127.0.0.1",
    ApiKey: "",
    ApiVersion: "",
    Model: "verification-model",
    ContextWindowTokens: 128_000,
    Temperature: 0,
    MaxOutputTokens: -1,
    Stream: true,
    TimeoutMs: 1_000,
    FirstTokenTimeoutMs: 1_000,
    MaxRequestMs: 1_000,
    MaxNetworkRetries: 0,
    RetryBaseDelayMs: 1,
    RetryMaxDelayMs: 1,
    RetryAfterMaxDelayMs: 1,
    Headers: {},
  };
}

void main();
