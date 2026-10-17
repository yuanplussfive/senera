import { getCurrentTools, type Context } from "@earendil-works/pi-ai";
import { AgentPiModelRequestExecutor } from "../ModelEndpoints/AgentPiModelRequestExecutor.js";
import type { AgentModelUsageSink } from "../ModelEndpoints/AgentModelUsage.js";
import type { AgentModelTimingSink } from "../ModelEndpoints/AgentModelTiming.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import { AgentPiNativeToolBridgeName } from "../Pi/AgentPiNativeToolBridge.js";
import type { AgentResidentSpeechNativeContinuation } from "./AgentResidentSpeechTypes.js";
import {
  buildAgentNativeToolRepairPrompt,
  extractAgentNativeToolArguments,
  isAgentNativeToolContractFailure,
} from "../ModelEndpoints/AgentNativeToolCallRecovery.js";

export class AgentResidentSpeechNativeClient {
  private readonly executor: AgentPiModelRequestExecutor;
  constructor(private readonly configuration: ResolvedAgentModelProviderConfig) {
    this.executor = new AgentPiModelRequestExecutor(configuration, "ResidentSpeech");
  }
  async project(input: {
    readonly context: Context;
    readonly continuation: AgentResidentSpeechNativeContinuation;
    readonly signal?: AbortSignal;
    readonly sessionId: string;
    readonly validate?: (value: unknown) => void;
    readonly usageSink?: AgentModelUsageSink;
    readonly timingSink?: AgentModelTimingSink;
  }): Promise<unknown> {
    const availableTools = input.context.tools ?? getCurrentTools(input.context.messages);
    if (!availableTools.some((tool) => tool.name === AgentPiNativeToolBridgeName))
      throw new Error(`Resident speech requires the ${AgentPiNativeToolBridgeName} bridge.`);
    let context = input.context;
    for (let attempt = 0; ; attempt += 1) {
      let value: unknown;
      try {
        await this.executor.execute({
          requestId: `${input.sessionId}:resident-speech:${attempt + 1}`,
          stage: "pi.resident_speech.native",
          context,
          signal: input.signal,
          usageSink: input.usageSink,
          timingSink: input.timingSink,
          stream: (signal) =>
            input.continuation.stream({
              context,
              requiredToolName: AgentPiNativeToolBridgeName,
              toolChoice: "required",
              signal,
            }),
          validate: (message) => {
            value = extractAgentNativeToolArguments(message, AgentPiNativeToolBridgeName);
            input.validate?.(value);
          },
        });
        return value;
      } catch (error) {
        if (
          attempt >= this.configuration.MaxNetworkRetries ||
          input.signal?.aborted ||
          !isAgentNativeToolContractFailure(error)
        )
          throw error;
        context = {
          ...context,
          messages: [
            ...context.messages,
            {
              role: "user",
              content: buildAgentNativeToolRepairPrompt(AgentPiNativeToolBridgeName, error),
              timestamp: Date.now(),
            },
          ],
        };
      }
    }
  }
}
