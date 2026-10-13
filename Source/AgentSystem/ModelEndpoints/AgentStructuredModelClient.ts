import { z } from "zod";
import type { Tool } from "@earendil-works/pi-ai";
import { b as baml } from "../BamlClient/baml_client/index.js";
import type TypeBuilder from "../BamlClient/baml_client/type_builder.js";
import { createAgentBamlPromptBuilderRegistry } from "../ActionPlanner/AgentActionPlannerBamlPromptFactory.js";
import { projectPlainBamlRequestBody } from "../ActionPlanner/AgentActionPlannerPromptProjector.js";
import { AgentActionPlannerModelTransport } from "../ActionPlanner/AgentActionPlannerModelTransport.js";
import {
  AgentBamlStructuredOutputRunner,
  type AgentBamlModelRequest,
} from "../BamlClient/AgentBamlStructuredOutputRunner.js";
import { AgentRequiredNativeToolCall } from "./AgentRequiredNativeToolCall.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type {
  AgentLanguageModelCacheOptions,
  AgentLanguageModelImageAttachment,
  AgentLanguageModelMessage,
} from "./AgentLanguageModel.js";
import type { AgentModelUsageSink } from "./AgentModelUsage.js";
import type { AgentModelTimingSink } from "./AgentModelTiming.js";
import { ensureAgentModelCacheStablePrefix } from "./AgentModelCacheScope.js";
import { throwAbortReason } from "../Core/AgentCancellation.js";
import { attachAgentModelRequestImages } from "./AgentPiModelRequestProjection.js";

export type AgentAuxiliaryBamlFunction =
  | "RewriteStateCard"
  | "ExtractMemOSFragment"
  | "SummarizeMemOSPeriod"
  | "CompressToolObservation"
  | "ChannelFinalDelivery"
  | "AnalyzeImage"
  | "SummarizePiContext"
  | "ProjectResidentSpeech";

export interface AgentStructuredModelContract<T> {
  readonly name: string;
  readonly description: string;
  readonly schema: z.ZodType<T>;
  readonly bamlFunction: AgentAuxiliaryBamlFunction;
  readonly bamlTypes?: TypeBuilder;
}

export interface AgentStructuredModelRequest<T> {
  readonly contract: AgentStructuredModelContract<T>;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly requestId: string;
  readonly signal?: AbortSignal;
  readonly cache?: AgentLanguageModelCacheOptions;
  readonly attachments?: readonly AgentLanguageModelImageAttachment[];
  readonly messages?: readonly AgentLanguageModelMessage[];
  readonly timingSink?: AgentModelTimingSink;
  /** A durable job can own retries, avoiding nested provider retry budgets. */
  readonly managedRetries?: boolean;
}

/** New auxiliary features supply a contract and data; Pi/BAML dispatch and repair are shared. */
export class AgentStructuredModelClient {
  private readonly transport: AgentActionPlannerModelTransport;
  private readonly nativeCall: AgentRequiredNativeToolCall;
  private readonly maxRepairAttempts: number;
  private readonly usageSink?: AgentModelUsageSink;
  private readonly timingSink?: AgentModelTimingSink;
  constructor(
    private readonly configuration: ResolvedAgentModelProviderConfig,
    purpose: string,
    options: {
      readonly maxRepairAttempts?: number;
      readonly usageSink?: AgentModelUsageSink;
      readonly timingSink?: AgentModelTimingSink;
    } = {},
  ) {
    this.maxRepairAttempts = options.maxRepairAttempts ?? configuration.MaxNetworkRetries;
    this.usageSink = options.usageSink;
    this.timingSink = options.timingSink;
    this.transport = new AgentActionPlannerModelTransport(configuration, options.usageSink, options.timingSink, {
      omitOutputTokenLimit: true,
    });
    this.nativeCall = new AgentRequiredNativeToolCall(
      configuration,
      purpose,
      options.usageSink,
      this.maxRepairAttempts,
      options.timingSink,
    );
  }

  async execute<T>(input: AgentStructuredModelRequest<T>): Promise<T> {
    throwAbortReason(input.signal);
    const contract = input.contract;
    if (this.configuration.ToolPlanningMode === "native") {
      const tool = {
        name: contract.name,
        description: contract.description,
        parameters: z.toJSONSchema(contract.schema, { target: "draft-7", io: "input" }),
        constrainedSampling: { type: "json_schema", strict: "prefer" },
      } satisfies Tool;
      const caller = input.managedRetries
        ? new AgentRequiredNativeToolCall(this.configuration, contract.name, this.usageSink, 0, this.timingSink)
        : this.nativeCall;
      const result = await caller.execute({
        tool,
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        requestId: input.requestId,
        signal: input.signal,
        cache: input.cache,
        timingSink: input.timingSink,
        messages: input.messages,
        providerRetries: !input.managedRetries,
        validate: (value) => {
          contract.schema.parse(value);
        },
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      });
      return contract.schema.parse(result);
    }
    if (this.configuration.ToolPlanningMode !== "baml")
      throw new Error(`Unsupported structured model mode: ${String(this.configuration.ToolPlanningMode)}.`);
    const request = await baml.request[contract.bamlFunction](input.userPrompt, {
      clientRegistry: createAgentBamlPromptBuilderRegistry(),
      ...(contract.bamlTypes ? { tb: contract.bamlTypes } : {}),
    });
    const prompt = projectPlainBamlRequestBody(request.body.json() as Record<string, unknown>);
    const systemPrompt = [input.systemPrompt, prompt.systemPrompt].filter(Boolean).join("\n\n");
    const cache = ensureAgentModelCacheStablePrefix(input.cache, {
      discriminator: contract.bamlFunction,
      stablePrefix: { systemPrompt, tools: [] },
    });
    const messages = [...attachAgentModelRequestImages(input.messages ?? prompt.messages, input.attachments)];
    const base: AgentBamlModelRequest = {
      requestId: input.requestId,
      step: 0,
      systemPrompt,
      messages,
      signal: input.signal,
      cache,
      ...(input.managedRetries ? { retryMode: "pi" } : {}),
    };
    const runner = new AgentBamlStructuredOutputRunner({
      complete: (call, signal) => this.transport.complete(call, signal, input.timingSink),
      maxRepairAttempts: input.managedRetries ? 0 : this.maxRepairAttempts,
    });
    const result = await runner.run({
      functionName: contract.bamlFunction,
      request: base,
      signal: input.signal,
      parse: (raw) =>
        contract.schema.parse(
          baml.parse[contract.bamlFunction](raw, contract.bamlTypes ? { tb: contract.bamlTypes } : undefined),
        ),
      repair: (failure) => ({
        ...base,
        requestId: `${base.requestId}:repair:${failure.repairAttempt}`,
        messages: [
          ...base.messages,
          {
            role: "user",
            content: JSON.stringify({
              instruction: "Correct the structured output to satisfy its contract. Return only the requested result.",
              issues: failure.issues,
            }),
          },
        ],
      }),
    });
    return result.value;
  }
}
