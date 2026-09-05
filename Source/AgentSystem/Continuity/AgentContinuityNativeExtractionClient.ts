import { Type, type Tool } from "@earendil-works/pi-ai";
import type { AgentContinuityFactPromptInput } from "../ActionPlanner/AgentLearningPromptJson.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import {
  AgentContinuityFactToolName,
  createAgentContinuityFactExtractionContext,
} from "./AgentContinuityNativeExtractionPrompt.js";
import { AgentContinuityRelationCatalog } from "./AgentContinuityRelationCatalog.js";
import { AgentRequiredNativeToolCall } from "../ModelEndpoints/AgentRequiredNativeToolCall.js";
import type { AgentStablePromptInvocationOptions } from "../ModelEndpoints/AgentLanguageModel.js";
import type { AgentModelUsageSink } from "../ModelEndpoints/AgentModelUsage.js";

const RelationId = Type.Union(AgentContinuityRelationCatalog.map(({ id }) => Type.Literal(id)));
const FactCaptureItem = Type.Object(
  {
    kind: Type.Union([Type.Literal("fact"), Type.Literal("profile"), Type.Literal("relation")]),
    text: Type.Optional(Type.String({ minLength: 1 })),
    key: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    value: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Number(), Type.Boolean()])),
    from: Type.Optional(Type.String({ minLength: 1 })),
    relation: Type.Optional(RelationId),
    to: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

const AgendaDraft = Type.Object(
  {
    kind: Type.Union([Type.Literal("goal"), Type.Literal("activity"), Type.Literal("event"), Type.Literal("schedule")]),
    change: Type.Union([
      Type.Literal("create"),
      Type.Literal("start"),
      Type.Literal("progress"),
      Type.Literal("finish"),
      Type.Literal("cancel"),
    ]),
    actor: Type.Union([Type.Literal("user"), Type.Literal("resident"), Type.Literal("system")]),
    summary: Type.String({ minLength: 1 }),
    timeText: Type.Optional(Type.String({ minLength: 1 })),
    relatesTo: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

const NativeFactTool = {
  name: AgentContinuityFactToolName,
  description: "Commit shallow source-backed facts, profiles, typed relations, and world agenda changes.",
  parameters: Type.Object(
    {
      items: Type.Array(FactCaptureItem),
      agenda: Type.Array(AgendaDraft),
      needsRulePass: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
} satisfies Tool;

export class AgentContinuityNativeExtractionClient {
  private readonly call: AgentRequiredNativeToolCall;

  constructor(configuration: ResolvedAgentModelProviderConfig, usageSink?: AgentModelUsageSink) {
    this.call = new AgentRequiredNativeToolCall(configuration, "Continuity", usageSink);
  }

  async extract(input: AgentContinuityFactPromptInput, options: AgentStablePromptInvocationOptions): Promise<unknown> {
    return this.call.execute({
      tool: NativeFactTool,
      ...createAgentContinuityFactExtractionContext(input, options.stableSystemPrompt),
      signal: options.signal,
      cache: options.cache,
    });
  }
}
