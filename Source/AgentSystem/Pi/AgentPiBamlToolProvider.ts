import {
  createAssistantMessageEventStream,
  createProvider,
  hasApi,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type Provider,
  type ProviderStreams,
  type SimpleStreamOptions,
  type Usage,
} from "@earendil-works/pi-ai";
import { errorMessage } from "../Core/AgentErrors.js";
import { AgentModelUsageLedger, type AgentModelUsageValue } from "../ModelEndpoints/AgentModelUsage.js";
import { AgentModelTokenEstimator } from "../Text/AgentTextBudget.js";
import type { AgentPiMutableSessionFrame } from "./AgentPiCodingAgentSessionFrame.js";
import { AgentPiDiagnosticSources, emitAgentPiDiagnostic } from "./AgentPiDiagnostics.js";
import type { AgentPiPlanningCompilerFactory } from "./AgentPiPlanningCompiler.js";
import { registerAgentPiToolCallBatch } from "./AgentPiToolCallBatchProjector.js";
import type { AgentPiModelApi, AgentPiProviderProjection } from "./AgentPiTypes.js";

export interface AgentPiBamlToolProviderOptions {
  readonly projection: AgentPiProviderProjection;
  readonly frame: AgentPiMutableSessionFrame;
  readonly compilerFactory: AgentPiPlanningCompilerFactory;
}

/** Pi provider that compiles tool decisions through Senera's BAML planner. */
export class AgentPiBamlToolProvider {
  private readonly outputEstimator: AgentModelTokenEstimator;

  constructor(private readonly options: AgentPiBamlToolProviderOptions) {
    this.outputEstimator = new AgentModelTokenEstimator({ model: options.projection.model.id });
  }

  create(): Provider<AgentPiModelApi> {
    const model = this.options.projection.model satisfies Model<AgentPiModelApi>;
    return createProvider<AgentPiModelApi>({
      id: this.options.projection.providerId,
      name: "Senera BAML Tool Planning",
      auth: {
        apiKey: {
          name: "Senera runtime",
          resolve: () => Promise.resolve({ auth: {} }),
        },
      },
      models: [model],
      api: {
        stream: (requestModel, context, streamOptions) => this.stream(requestModel, context, streamOptions),
        streamSimple: (requestModel, context, streamOptions) => this.stream(requestModel, context, streamOptions),
      } satisfies ProviderStreams,
    });
  }

  private stream(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
    const stream = createAssistantMessageEventStream();
    if (!hasApi(model, "senera-planning")) {
      const failed = createAssistantMessage(model, emptyPiUsage(), "error");
      failed.errorMessage = `Unsupported Senera BAML tool provider API: ${model.api}.`;
      stream.push({ type: "start", partial: { ...failed, stopReason: "pending" } });
      stream.push({ type: "error", reason: "error", error: failed });
      stream.end(failed);
      return stream;
    }
    queueMicrotask(() => {
      void this.compile(stream, model, context, options);
    });
    return stream;
  }

  private async compile(
    stream: AssistantMessageEventStream,
    model: Model<AgentPiModelApi>,
    context: Context,
    options?: SimpleStreamOptions,
  ): Promise<void> {
    const frame = this.options.frame.snapshot();
    const turnState = frame.turnState;
    const localUsage = new AgentModelUsageLedger();
    const initial = createAssistantMessage(model, emptyPiUsage(), "pending");
    stream.push({ type: "start", partial: initial });
    try {
      if (!turnState) throw new Error("Senera BAML tool provider requires an active turn state.");
      throwIfProviderAborted(options?.signal);
      const compiler = this.options.compilerFactory.create({
        usageSink: (call) => {
          localUsage.record(call);
          turnState.context.usageLedger.record(call);
          turnState.context.tokenBudget.recordProviderInputTokens(
            (call.usage.inputTokens ?? 0) + (call.usage.cacheReadTokens ?? 0) + (call.usage.cacheWriteTokens ?? 0),
          );
        },
        timingSink: (timing) =>
          emitAgentPiDiagnostic(frame.diagnostics, {
            context: {
              sessionId: frame.sessionId,
              requestId: frame.requestId,
              step: frame.step,
            },
            source: AgentPiDiagnosticSources.Provider,
            name: "model_timing",
            details: timing,
          }),
      });
      const compilation = await compiler.compile({
        model,
        context,
        options,
        toolAccessGrant: turnState.context.toolAccessGrant,
        signal: options?.signal,
        runtime: turnState.context,
      });
      throwIfProviderAborted(options?.signal);
      const outputText = JSON.stringify({ content: compilation.content, toolCalls: compilation.toolCalls });
      const usage = projectPiUsage(localUsage.contextUsage(), this.outputEstimator.estimate(outputText).tokenCount);
      const message = createAssistantMessage(
        model,
        usage,
        compilation.toolCalls.length > 0 ? "toolUse" : "stop",
        compilation,
      );
      await registerAgentPiToolCallBatch(this.options.frame, message);
      emitAssistantMessage(stream, message);
    } catch (error) {
      const reason = options?.signal?.aborted ? "aborted" : "error";
      const failed = {
        ...initial,
        stopReason: reason,
        errorMessage: errorMessage(options?.signal?.reason ?? error),
      } satisfies AssistantMessage;
      stream.push({ type: "error", reason, error: failed });
      stream.end(failed);
    }
  }
}

function emitAssistantMessage(stream: AssistantMessageEventStream, message: AssistantMessage): void {
  const partial: AssistantMessage = { ...message, content: [], stopReason: "pending" };
  for (const block of message.content) {
    const contentIndex = partial.content.length;
    if (block.type === "text") {
      partial.content = [...partial.content, { type: "text", text: "" }];
      stream.push({ type: "text_start", contentIndex, partial: { ...partial } });
      partial.content[contentIndex] = block;
      if (block.text) {
        stream.push({ type: "text_delta", contentIndex, delta: block.text, partial: { ...partial } });
      }
      stream.push({ type: "text_end", contentIndex, content: block.text, partial: { ...partial } });
      continue;
    }
    if (block.type !== "toolCall") continue;
    partial.content = [...partial.content, { type: "toolCall", id: block.id, name: block.name, arguments: {} }];
    stream.push({ type: "toolcall_start", contentIndex, partial: { ...partial } });
    stream.push({
      type: "toolcall_delta",
      contentIndex,
      delta: JSON.stringify(block.arguments),
      partial: { ...partial },
    });
    partial.content[contentIndex] = block;
    stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: { ...partial } });
  }
  stream.push({
    type: "done",
    reason: message.stopReason === "toolUse" ? "toolUse" : message.stopReason === "length" ? "length" : "stop",
    message,
  });
  stream.end(message);
}

function createAssistantMessage<TApi extends Api>(
  model: Model<TApi>,
  usage: Usage,
  stopReason: AssistantMessage["stopReason"],
  compilation?: {
    content: string;
    toolCalls: Array<{ id?: string; name: string; arguments: Record<string, unknown> }>;
  },
): AssistantMessage {
  return {
    role: "assistant",
    api: model.api,
    provider: model.provider,
    model: model.id,
    content: [
      ...(compilation?.content ? [{ type: "text" as const, text: compilation.content }] : []),
      ...(compilation?.toolCalls.map((call) => ({
        type: "toolCall" as const,
        id: requireToolCallId(call.id),
        name: call.name,
        arguments: call.arguments,
      })) ?? []),
    ],
    usage,
    stopReason,
    timestamp: Date.now(),
  };
}

function projectPiUsage(contextUsage: AgentModelUsageValue | undefined, outputTokens: number): Usage {
  const input = contextUsage?.inputTokens ?? 0;
  const cacheRead = contextUsage?.cacheReadTokens ?? 0;
  const cacheWrite = contextUsage?.cacheWriteTokens ?? 0;
  return {
    input,
    output: outputTokens,
    cacheRead,
    cacheWrite,
    reasoning: contextUsage?.reasoningTokens,
    totalTokens: input + outputTokens + cacheRead + cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function emptyPiUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function requireToolCallId(value: string | undefined): string {
  if (value) return value;
  throw new Error("Senera planning compiler returned a tool call without an id.");
}

function throwIfProviderAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error("Senera BAML tool provider request was aborted.");
}
