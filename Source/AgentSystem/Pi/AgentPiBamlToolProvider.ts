import {
  createAssistantMessageEventStream,
  createProvider,
  hasApi,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type JsonObject,
  type JsonValue,
  type Model,
  type ProviderStreams,
  type SimpleStreamOptions,
  type Usage,
} from "@earendil-works/pi-ai";
import { errorMessage } from "../Core/AgentErrors.js";
import type { AgentModelUsageLedger, AgentModelUsageValue } from "../ModelEndpoints/AgentModelUsage.js";
import {
  type AgentModelCost,
  type AgentPricedPiUsage,
  projectAgentPiModelPrices,
} from "../ModelEndpoints/AgentModelPricing.js";
import { AgentModelTokenEstimator } from "../Text/AgentTextBudget.js";
import type { AgentPiMutableSessionFrame } from "./AgentPiCodingAgentSessionFrame.js";
import { AgentPiDiagnosticSources, emitAgentPiDiagnostic } from "./AgentPiDiagnostics.js";
import type { AgentPiPlanningCompilerFactory } from "./AgentPiPlanningCompiler.js";
import { registerAgentPiToolCallBatch } from "./AgentPiToolCallBatchProjector.js";
import type { AgentPiModelApi, AgentPiProviderProjection } from "./AgentPiTypes.js";
import { emitAgentPiAssistantMessage } from "./AgentPiAssistantMessageStream.js";
import { exposeAgentPiContextProvider, type AgentPiContextProvider } from "./AgentPiProviderCompatibility.js";
import { projectAgentPiBamlContext } from "./AgentPiBamlContextAdapter.js";
import { AgentModelInputBudgetError } from "../Text/AgentTurnTokenBudget.js";
import { withAgentModelDiagnosticScope } from "../Diagnostics/AgentModelDiagnosticScope.js";

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

  create(): AgentPiContextProvider<AgentPiModelApi> {
    const model = this.options.projection.model satisfies Model<AgentPiModelApi>;
    return exposeAgentPiContextProvider(
      createProvider<AgentPiModelApi>({
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
      }),
    );
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
    const initial = createAssistantMessage(model, emptyPiUsage(), "pending");
    const compactionRequest = options?.cacheRetention === "none";
    // Reserve before publishing start or awaiting input preparation. Both the
    // success and failure streams belong to this same model request.
    const modelMessageIndex = compactionRequest ? undefined : turnState?.beginModelRequest();
    let started = false;
    const start = () => {
      if (started) return;
      stream.push({ type: "start", partial: initial });
      started = true;
    };
    let localUsage: AgentModelUsageLedger | undefined;
    try {
      if (!turnState) {
        throw new Error("Senera BAML tool provider requires an active model request.");
      }
      const preparedContext =
        !compactionRequest && frame.prepareModelInput ? await frame.prepareModelInput(context) : context;
      if (!compactionRequest) frame.synchronizeToolContracts?.(preparedContext);
      if (modelMessageIndex !== undefined) {
        turnState.modelContexts.set(
          modelMessageIndex,
          this.options.frame.contextInspection.capture({
            context: preparedContext,
            model: model.id,
            scope: "baml-input",
            state: turnState,
          }),
        );
      }
      start();
      localUsage = turnState.context.usageLedger.fork();
      const usageLedger = localUsage;
      throwIfProviderAborted(options?.signal);
      const compiler = this.options.compilerFactory.create({
        usageSink: (call) => {
          usageLedger.record(call);
          turnState.context.tokenBudget.recordProviderContextTokens(
            call.usage.totalTokens ||
              (call.usage.inputTokens ?? 0) +
                (call.usage.outputTokens ?? 0) +
                (call.usage.cacheReadTokens ?? 0) +
                (call.usage.cacheWriteTokens ?? 0),
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

      if (compactionRequest) {
        const compact = compiler.compact?.bind(compiler);
        if (!compact) {
          throw new Error("Senera BAML compaction transport is not configured.");
        }
        const outputText = await withAgentModelDiagnosticScope(
          {
            sink: frame.diagnostics,
            context: { sessionId: frame.sessionId, requestId: frame.requestId, step: frame.step, modelMessageIndex },
          },
          () =>
            compact({
              model,
              context: preparedContext,
              signal: options?.signal,
              runtime: {
                sessionId: frame.sessionId,
                logicalCacheScope: turnState.context.logicalCacheScope,
              },
            }),
        );
        throwIfProviderAborted(options?.signal);
        const outputTextJson = JSON.stringify({ content: outputText, toolCalls: [] });
        const usage = projectPiUsage(
          localUsage.contextUsage(),
          this.outputEstimator.estimate(outputTextJson).tokenCount,
          localUsage.aggregate()?.cost,
        );
        const message = createAssistantMessage(model, usage, "stop", { content: outputText, toolCalls: [] });
        if (localUsage.contextUsage()) turnState.context.tokenBudget.recordProviderUsage(usage, message);
        else turnState.context.tokenBudget.recordEstimatedAssistantResponse(message);
        emitAgentPiAssistantMessage(stream, message, { started: true });
        return;
      }

      const planningRequest = projectAgentPiBamlContext(preparedContext);
      const compilation = await withAgentModelDiagnosticScope(
        {
          sink: frame.diagnostics,
          context: { sessionId: frame.sessionId, requestId: frame.requestId, step: frame.step, modelMessageIndex },
        },
        () =>
          compiler.compile({
            model,
            context: planningRequest,
            options,
            toolAccessGrant: turnState.context.toolAccessGrant,
            signal: options?.signal,
            runtime: turnState.context,
          }),
      );
      frame.onModelMemoryDelivered?.();
      throwIfProviderAborted(options?.signal);
      const outputText = JSON.stringify({ content: compilation.content, toolCalls: compilation.toolCalls });
      const usage = projectPiUsage(
        localUsage.contextUsage(),
        this.outputEstimator.estimate(outputText).tokenCount,
        localUsage.aggregate()?.cost,
      );
      const message = createAssistantMessage(
        model,
        usage,
        compilation.toolCalls.length > 0 ? "toolUse" : "stop",
        compilation,
      );
      if (localUsage.contextUsage()) turnState.context.tokenBudget.recordProviderUsage(usage, message);
      else turnState.context.tokenBudget.recordEstimatedAssistantResponse(message);
      const purposesByCallId = new Map(
        compilation.toolCalls.flatMap((call) =>
          call.id && call.purpose?.trim() ? [[call.id, call.purpose.trim()] as const] : [],
        ),
      );
      await registerAgentPiToolCallBatch(this.options.frame, message, {
        purposesByCallId,
        modelMessageIndex,
      });
      emitAgentPiAssistantMessage(stream, message, { started: true });
    } catch (error) {
      start();
      if (!compactionRequest && error instanceof AgentModelInputBudgetError) {
        await emitAgentPiDiagnostic(frame.diagnostics, {
          context: { sessionId: frame.sessionId, requestId: frame.requestId, step: frame.step },
          source: AgentPiDiagnosticSources.Provider,
          name: "context_budget.rejected",
          details: {
            phase: compactionRequest ? "pi.compaction" : "pi.turn",
            ...error.inspection,
          },
        });
      }
      const reason = options?.signal?.aborted ? "aborted" : "error";
      const failureUsage = localUsage?.aggregate();
      const failed = {
        ...initial,
        usage: failureUsage
          ? projectPiUsage(failureUsage, failureUsage.outputTokens ?? 0, failureUsage.cost)
          : ({ ...initial.usage, seneraCost: { currency: "USD" } } as AgentPricedPiUsage),
        stopReason: reason,
        errorMessage: errorMessage(options?.signal?.reason ?? error),
      } satisfies AssistantMessage;
      stream.push({ type: "error", reason, error: failed });
      stream.end(failed);
    }
  }
}

function createAssistantMessage<TApi extends Api>(
  model: Model<TApi>,
  usage: Usage,
  stopReason: AssistantMessage["stopReason"],
  compilation?: {
    content: string;
    toolCalls: Array<{ id?: string; name: string; arguments: Record<string, unknown>; purpose?: string }>;
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
        arguments: toPiJsonObject(call.arguments),
      })) ?? []),
    ],
    usage,
    stopReason,
    timestamp: Date.now(),
  };
}

function toPiJsonObject(value: Record<string, unknown>): JsonObject {
  const projected = toPiJsonValue(value);
  if (!isPiJsonObject(projected)) {
    throw new Error("Senera planning compiler returned non-object tool arguments.");
  }
  return projected;
}

function isPiJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPiJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) return value.map(toPiJsonValue);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toPiJsonValue(entry)]));
  }
  throw new Error("Senera planning compiler returned a non-JSON tool argument.");
}

function projectPiUsage(
  contextUsage: AgentModelUsageValue | undefined,
  outputTokens: number,
  cost?: AgentModelCost,
): AgentPricedPiUsage {
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
    seneraCost: cost,
    seneraUsage: contextUsage
      ? { ...contextUsage, cost }
      : {
          source: "local_estimate",
          outputTokens,
          totalTokens: outputTokens,
          estimatedFields: ["outputTokens", "totalTokens"],
          cost,
        },
    cost: { ...projectAgentPiModelPrices(cost), total: cost?.total ?? 0 },
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
