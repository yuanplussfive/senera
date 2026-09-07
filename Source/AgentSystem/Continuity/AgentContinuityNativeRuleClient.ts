import { Type, type Tool } from "@earendil-works/pi-ai";
import type { AgentContinuityRulePromptInput } from "../ActionPlanner/AgentLearningPromptJson.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import { AgentContinuityConditionMatches, AgentContinuityNamedLifetimes } from "./AgentContinuityLearningSchema.js";
import {
  AgentContinuityRuleToolName,
  createAgentContinuityRuleExtractionContext,
} from "./AgentContinuityNativeExtractionPrompt.js";
import { AgentRequiredNativeToolCall } from "../ModelEndpoints/AgentRequiredNativeToolCall.js";
import type { AgentStablePromptInvocationOptions } from "../ModelEndpoints/AgentLanguageModel.js";
import type { AgentModelUsageSink } from "../ModelEndpoints/AgentModelUsage.js";

const Scalar = Type.Union([Type.String({ minLength: 1 }), Type.Number(), Type.Boolean()]);
const Lifetime = Type.Union([
  ...AgentContinuityNamedLifetimes.map((value) => Type.Literal(value)),
  Type.String({ format: "date-time" }),
]);
const RuleItem = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("state"),
      Type.Literal("always"),
      Type.Literal("conditional"),
      Type.Literal("notify"),
    ]),
    title: Type.String({ minLength: 1 }),
    target: Type.Optional(Type.String({ minLength: 1 })),
    replace: Type.Optional(Type.Boolean()),
    value: Type.Optional(Scalar),
    when: Type.Optional(Type.Object({}, { additionalProperties: Scalar, minProperties: 1 })),
    at: Type.Optional(Type.String({ format: "date-time" })),
    match: Type.Optional(Type.Union(AgentContinuityConditionMatches.map((value) => Type.Literal(value)))),
    threshold: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    effect: Type.Optional(Type.String({ minLength: 1 })),
    until: Lifetime,
  },
  { additionalProperties: false },
);

const NativeRuleTool = {
  name: AgentContinuityRuleToolName,
  description: "Commit one or more source-backed continuity models through one shallow item list.",
  parameters: Type.Object(
    {
      items: Type.Array(RuleItem),
    },
    { additionalProperties: false },
  ),
} satisfies Tool;

export class AgentContinuityNativeRuleClient {
  private readonly call: AgentRequiredNativeToolCall;

  constructor(configuration: ResolvedAgentModelProviderConfig, usageSink?: AgentModelUsageSink) {
    this.call = new AgentRequiredNativeToolCall(configuration, "Continuity", usageSink);
  }

  async extract(input: AgentContinuityRulePromptInput, options: AgentStablePromptInvocationOptions): Promise<unknown> {
    return this.call.execute({
      tool: NativeRuleTool,
      ...createAgentContinuityRuleExtractionContext(input, options.stableSystemPrompt),
      signal: options.signal,
      cache: options.cache,
    });
  }
}
