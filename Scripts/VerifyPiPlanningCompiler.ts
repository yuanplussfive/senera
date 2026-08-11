import assert from "node:assert/strict";
import {
  AgentPiPlanningCompiler,
  type AgentPiPlanningModelClient,
} from "../Source/AgentSystem/Pi/AgentPiPlanningCompiler.js";
import type {
  AgentPiControllerDecisionInput,
  AgentPiToolArgumentsInput,
  AgentPiToolArgumentsRepairInput,
} from "../Source/AgentSystem/PiShared/AgentPiPlanningTypes.js";
import type { ResolvedAgentModelProviderConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import {
  createAgentToolAccessGrant,
  emptyAgentToolAccessGrant,
} from "../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { projectSeneraModelProviderToPi } from "../Source/AgentSystem/Pi/AgentPiModelProjector.js";

class VerificationClient implements AgentPiPlanningModelClient {
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

  async summarizePiConversation(): Promise<never> {
    throw new Error("Conversation summary is outside this verification.");
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
  const compiler = new AgentPiPlanningCompiler({ modelProvider: modelProvider(), client });
  const model = projectSeneraModelProviderToPi(modelProvider()).model;

  const direct = await compiler.compile({
    toolAccessGrant: emptyAgentToolAccessGrant(),
    model,
    context: {
      messages: [{ role: "user", content: "Summarize.", timestamp: 1 }],
      tools: [],
    },
  });
  assert.deepEqual(direct, { kind: "final_text", content: "The turn is complete.", toolCalls: [] });

  const executed = await compiler.compile({
    toolAccessGrant: createAgentToolAccessGrant({
      authorizedToolNames: ["WorkspaceReadFile"],
      exposedToolNames: ["WorkspaceReadFile"],
      preferredToolNames: ["WorkspaceReadFile"],
    }),
    model,
    context: {
      messages: [{ role: "user", content: "Read package.json.", timestamp: 1 }],
      tools: [
        {
          name: "WorkspaceReadFile",
          description: "Read a workspace file.",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
            additionalProperties: false,
          },
        },
      ],
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

  process.stdout.write("Pi planning compiler verification passed.\n");
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
    ToolPlanningMode: "baml",
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
