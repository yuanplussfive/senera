import type { AssistantMessage, Tool } from "@earendil-works/pi-ai";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type {
  AgentLanguageModelCacheOptions,
  AgentLanguageModelImageAttachment,
  AgentLanguageModelMessage,
} from "./AgentLanguageModel.js";
import type { AgentModelUsageSink } from "./AgentModelUsage.js";
import type { AgentModelTimingSink } from "./AgentModelTiming.js";
import type { AgentPromptWireSnapshot } from "./AgentPromptWireSnapshot.js";
import { projectAgentNativeRequiredToolChoice } from "./AgentModelEndpointContract.js";
import { ensureAgentModelCacheStablePrefix } from "./AgentModelCacheScope.js";
import { AgentInvalidModelToolArgumentsError } from "./AgentModelFailureMapper.js";
import { AgentPiModelRequestExecutor } from "./AgentPiModelRequestExecutor.js";
import { projectAgentPiModelRequestContext, attachAgentModelRequestImages } from "./AgentPiModelRequestProjection.js";
import {
  buildAgentNativeToolRepairPrompt,
  extractAgentNativeToolArguments,
  isAgentNativeToolContractFailure,
} from "./AgentNativeToolCallRecovery.js";

/** A schema-bound auxiliary call. Pi execution, deadlines and accounting are shared with text and image requests. */
export class AgentRequiredNativeToolCall {
  private readonly executor: AgentPiModelRequestExecutor;
  constructor(
    private readonly configuration: ResolvedAgentModelProviderConfig,
    private readonly runtimeLabel: string,
    usageSink?: AgentModelUsageSink,
    private readonly maxRepairAttempts = configuration.MaxNetworkRetries,
    timingSink?: AgentModelTimingSink,
  ) {
    this.executor = new AgentPiModelRequestExecutor(configuration, runtimeLabel, usageSink, timingSink);
  }

  async execute(input: {
    readonly tool: Tool;
    readonly systemPrompt: string;
    readonly userPrompt: string;
    readonly validate?: (value: unknown) => void;
    readonly signal?: AbortSignal;
    readonly cache?: AgentLanguageModelCacheOptions;
    readonly requestId?: string;
    readonly timingSink?: AgentModelTimingSink;
    readonly wireSnapshotSink?: (snapshot: AgentPromptWireSnapshot) => void | Promise<void>;
    readonly providerRetries?: boolean;
    readonly attachments?: readonly AgentLanguageModelImageAttachment[];
    readonly messages?: readonly AgentLanguageModelMessage[];
  }): Promise<unknown> {
    const requestId = input.requestId ?? crypto.randomUUID();
    const cache = ensureAgentModelCacheStablePrefix(input.cache, {
      discriminator: `${this.runtimeLabel}:${input.tool.name}`,
      stablePrefix: {
        systemPrompt: input.systemPrompt,
        tools: [{ name: input.tool.name, description: input.tool.description, parameters: input.tool.parameters }],
      },
    });
    const baseMessages = attachAgentModelRequestImages(
      input.messages ?? [
        {
          role: "user",
          content: input.userPrompt,
        },
      ],
      input.attachments,
    );
    let messages = [...baseMessages];
    for (let attempt = 0; ; attempt += 1) {
      let value: unknown;
      const validate = (message: AssistantMessage) => {
        value = extractAgentNativeToolArguments(message, input.tool.name);
        try {
          input.validate?.(value);
        } catch (error) {
          if (error instanceof AgentInvalidModelToolArgumentsError) throw error;
          throw new AgentInvalidModelToolArgumentsError(input.tool.name, [
            error instanceof Error ? error.message : String(error),
          ]);
        }
      };
      try {
        await this.executor.execute({
          requestId: `${requestId}:${attempt + 1}`,
          stage: `${this.runtimeLabel}:${input.tool.name}`,
          context: {
            ...projectAgentPiModelRequestContext({ systemPrompt: input.systemPrompt, messages }, this.configuration),
            tools: [input.tool],
          },
          signal: input.signal,
          cache,
          validate,
          toolChoice: projectAgentNativeRequiredToolChoice(this.executor.api, input.tool.name),
          omitOutputTokenLimit: true,
          providerRetries: input.providerRetries,
          timingSink: input.timingSink,
          wireSnapshotSink: input.wireSnapshotSink,
        });
        return value;
      } catch (error) {
        if (attempt >= this.maxRepairAttempts || input.signal?.aborted || !isAgentNativeToolContractFailure(error))
          throw error;
        messages = [
          ...baseMessages,
          { role: "user", content: buildAgentNativeToolRepairPrompt(input.tool.name, error) },
        ];
      }
    }
  }
}
