import {
  clampThinkingLevel,
  createAssistantMessageEventStream,
  createProvider,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type Provider,
  type ProviderStreams,
  type SimpleStreamOptions,
  type StreamOptions,
} from "@earendil-works/pi-ai";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import {
  projectAgentNativeRequiredToolChoice,
  type AgentNativeToolApi,
} from "../ModelEndpoints/AgentModelEndpointContract.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { ModelRequestTimeoutError, normalizeModelHttpError } from "../ModelEndpoints/ModelHttpErrors.js";
import {
  AgentModelUsageLedger,
  AgentModelUsageSources,
  type AgentModelUsageValue,
} from "../ModelEndpoints/AgentModelUsage.js";
import type { AgentPiMutableSessionFrame } from "./AgentPiCodingAgentSessionFrame.js";
import { registerAgentPiToolCallBatch } from "./AgentPiToolCallBatchProjector.js";
import type { AgentPiTurnState } from "./AgentPiTurnState.js";
import type { AgentPiProviderProjection } from "./AgentPiTypes.js";
import {
  AgentNativeToolApiStreams,
  type AgentNativeToolApiStreams as AgentNativeToolApiStreamMap,
} from "../ModelEndpoints/AgentNativeToolApiStreams.js";
import type {
  AgentResidentSpeechNativeContinuation,
  AgentResidentSpeechProjector,
} from "../ResidentSpeech/AgentResidentSpeechTypes.js";
import { inspectAgentResidentSpeechFocus } from "../ResidentSpeech/AgentResidentSpeechPromptProjector.js";
import { createAgentResidentSpeechUsageSink } from "../ResidentSpeech/AgentResidentSpeechUsage.js";
import { shouldProjectResidentSpeech } from "../PiShared/AgentPiResidentSpeechProjection.js";
import { AgentPiDiagnosticSources, emitAgentPiDiagnostic } from "./AgentPiDiagnostics.js";
import { emitAgentPiAssistantMessage } from "./AgentPiAssistantMessageStream.js";
import {
  createAgentPiLogicalCacheScope,
  createAgentPiPromptCacheOptions,
  requireAgentPiPromptCacheSessionId,
} from "./AgentPiPromptCache.js";
import {
  createAgentPromptWireCapture,
  projectAgentStablePrefixBytes,
  projectAgentStablePrefixRevision,
  projectAgentPromptCacheRetention,
  resolveAgentPromptCacheObservation,
  resolveAgentPromptCacheStrategy,
} from "../ModelEndpoints/AgentPromptWireSnapshot.js";
import { AgentPiNativeToolBridgeName, projectAgentPiNativeToolCallDisplay } from "./AgentPiNativeToolBridge.js";

type NativeModel = Model<AgentNativeToolApi>;
type NativeStreamOptions = SimpleStreamOptions & {
  readonly toolChoice?: ReturnType<typeof projectAgentNativeRequiredToolChoice> | "auto";
  readonly reasoningEffort?: string;
};

export interface AgentPiNativeToolProviderOptions {
  readonly projection: AgentPiProviderProjection;
  readonly modelProvider: ResolvedAgentModelProviderConfig;
  readonly frame: AgentPiMutableSessionFrame;
  readonly residentSpeech?: AgentResidentSpeechProjector;
  readonly apiStreams?: AgentNativeToolApiStreamMap;
}

/** Pi provider that delegates tool decisions directly to the declared vendor API. */
export class AgentPiNativeToolProvider {
  constructor(private readonly options: AgentPiNativeToolProviderOptions) {}

  create(): Provider<AgentNativeToolApi> {
    const model = asNativeModel(this.options.projection.model, this.apiStreams);
    return createProvider<AgentNativeToolApi>({
      id: this.options.projection.providerId,
      name: `Senera Native Tools (${this.options.modelProvider.ProviderId})`,
      baseUrl: model.baseUrl,
      headers: model.headers,
      auth: {
        apiKey: {
          name: `Senera ${this.options.modelProvider.ProviderId} API key`,
          resolve: async () => ({
            auth: {
              ...(this.options.modelProvider.ApiKey ? { apiKey: this.options.modelProvider.ApiKey } : {}),
              headers: model.headers,
            },
            source: "Senera model configuration",
          }),
        },
      },
      models: [model],
      api: {
        stream: (requestModel, context, streamOptions) =>
          this.stream(asNativeModel(requestModel, this.apiStreams), context, streamOptions, false),
        streamSimple: (requestModel, context, streamOptions) =>
          this.stream(asNativeModel(requestModel, this.apiStreams), context, streamOptions, true),
      } satisfies ProviderStreams,
    });
  }

  private stream(
    model: NativeModel,
    context: Context,
    options: StreamOptions | SimpleStreamOptions | undefined,
    simple: boolean,
  ): AssistantMessageEventStream {
    const output = createAssistantMessageEventStream();
    queueMicrotask(() => {
      void this.forward(output, model, context, options, simple);
    });
    return output;
  }

  private async forward(
    output: AssistantMessageEventStream,
    model: NativeModel,
    context: Context,
    options: StreamOptions | SimpleStreamOptions | undefined,
    simple: boolean,
  ): Promise<void> {
    const frame = this.options.frame.snapshot();
    const turnState = frame.turnState;
    if (!turnState) {
      this.fail(output, model, new Error("Senera native tool provider requires an active turn state."));
      return;
    }
    const firstTokenController = new AbortController();
    const maxRequestController = new AbortController();
    const signal = combineSignals(options?.signal, firstTokenController.signal, maxRequestController.signal);
    const firstTokenTimer = startTimeout(
      firstTokenController,
      this.options.modelProvider.FirstTokenTimeoutMs,
      "first_token",
    );
    const maxRequestTimer = startTimeout(maxRequestController, this.options.modelProvider.MaxRequestMs, "max_request");
    const callerAborted = (): boolean =>
      signal.aborted && !firstTokenController.signal.aborted && !maxRequestController.signal.aborted;
    let started = false;
    const transactionalRoleplayStream = frame.roleplayPresetActive === true || frame.prefaceRewriteEnabled === true;
    try {
      const request = this.requestContext(context, frame.nativeProviderToolNames);
      turnState.context.tokenBudget.validateModelInput(request);
      const stableTools =
        request.tools?.map(({ name, description, parameters }) => ({ name, description, parameters })) ?? [];
      const stablePrefixRevision = projectAgentStablePrefixRevision({
        systemPrompt: request.systemPrompt ?? "",
        tools: stableTools,
      });
      const stablePrefixBytes = projectAgentStablePrefixBytes({
        systemPrompt: request.systemPrompt ?? "",
        tools: stableTools,
      });
      const logicalCacheScope =
        frame.logicalCacheScope ??
        createAgentPiLogicalCacheScope({ sessionId: requireAgentPiPromptCacheSessionId(frame.sessionId) });
      const cache = createAgentPiPromptCacheOptions({
        phase: "native-conversation",
        sessionId: frame.sessionId,
        logicalCacheScope,
        model: { provider: model.provider, api: model.api, model: model.id },
        stablePrefix: {
          systemPrompt: request.systemPrompt,
          tools: stableTools,
        },
      });
      const cacheStrategy = resolveAgentPromptCacheStrategy(model.api);
      const cacheRetention = projectAgentPromptCacheRetention(cacheStrategy, cache.retention);
      const wireCapture = createAgentPromptWireCapture({
        fetch: options?.fetch,
        onPayload: options?.onPayload,
      });
      const requestOptions: NativeStreamOptions = {
        ...(options ?? {}),
        signal,
        sessionId: cache.scope,
        cacheRetention,
        fetch: wireCapture.fetch,
        onPayload: wireCapture.onPayload,
        temperature: this.options.modelProvider.Temperature,
        timeoutMs: this.options.modelProvider.TimeoutMs,
        maxRetries: 0,
        maxRetryDelayMs: this.options.modelProvider.RetryAfterMaxDelayMs,
      };
      const source = this.delegate(model, request, requestOptions, simple);
      for await (const event of source) {
        if (isFirstTokenEvent(event)) firstTokenTimer?.clear();
        if (event.type === "start") started = true;
        if (event.type === "done") {
          this.recordUsage(turnState, event.message.usage);
          firstTokenTimer?.clear();
          maxRequestTimer?.clear();
          const message = await this.projectResidentSpeech(
            request,
            event.message,
            options?.signal,
            frame,
            turnState,
            model,
            requestOptions,
            logicalCacheScope,
            options,
          );
          await this.emitPromptCacheObservation(frame, model, cache, wireCapture, {
            sessionId: requireAgentPiPromptCacheSessionId(frame.sessionId),
            logicalCacheScope,
            retention: cacheRetention,
            stablePrefixRevision,
            stablePrefixBytes,
            usage: event.message.usage,
          });
          await registerAgentPiToolCallBatch(this.options.frame, message, {
            projectDisplayCall: projectAgentPiNativeToolCallDisplay,
          });
          if (transactionalRoleplayStream) emitAgentPiAssistantMessage(output, message);
          else {
            output.push({ ...event, message });
            output.end(message);
          }
          return;
        }
        if (event.type === "error") {
          const callerCancelled = callerAborted();
          const cancelled = callerCancelled || (event.reason === "aborted" && signal.aborted);
          this.fail(
            output,
            model,
            callerCancelled
              ? (signal.reason ?? new Error("Pi native provider request was aborted."))
              : new Error(event.error.errorMessage ?? "Pi native provider request failed."),
            started && !transactionalRoleplayStream,
            cancelled,
          );
          await this.emitPromptCacheObservation(frame, model, cache, wireCapture, {
            sessionId: requireAgentPiPromptCacheSessionId(frame.sessionId),
            logicalCacheScope,
            retention: cacheRetention,
            stablePrefixRevision,
            stablePrefixBytes,
            usage: { cacheRead: 0, cacheWrite: 0 },
          });
          return;
        }
        if (!transactionalRoleplayStream) output.push(event);
      }
      throw new Error("Pi native provider ended without a terminal event.");
    } catch (error) {
      const cancelled = callerAborted();
      const failure = cancelled
        ? (signal.reason ?? error)
        : (firstTokenController.signal.reason ?? maxRequestController.signal.reason ?? error);
      this.fail(output, model, failure, started && !transactionalRoleplayStream, cancelled);
    } finally {
      firstTokenTimer?.clear();
      maxRequestTimer?.clear();
    }
  }

  private delegate(
    model: NativeModel,
    context: Context,
    options: NativeStreamOptions,
    simple: boolean,
  ): AssistantMessageEventStream {
    const streams = this.apiStreams[model.api];
    if (!simple || options.toolChoice === undefined) {
      return simple
        ? streams.streamSimple(model, context, options)
        : streams.stream(model, context, options as StreamOptions);
    }

    // The Responses simple adapter drops adapter-specific toolChoice. Native
    // continuations must preserve the explicit choice on the provider wire.
    return streams.stream(model, context, projectExplicitToolChoiceOptions(model, options));
  }

  private requestContext(context: Context, providerToolNames: readonly string[]): Context {
    const availableTools = new Map<string, NonNullable<Context["tools"]>[number]>();
    for (const tool of context.tools ?? []) {
      if (availableTools.has(tool.name)) {
        throw new Error(`Pi native provider received duplicate tool definition: ${tool.name}.`);
      }
      availableTools.set(tool.name, tool);
    }
    const tools = providerToolNames.map((toolName) => {
      const tool = availableTools.get(toolName);
      if (!tool) throw new Error(`Pi native provider context is missing declared tool: ${toolName}.`);
      return tool;
    });
    return { ...context, tools };
  }

  private async projectResidentSpeech(
    context: Context,
    message: AssistantMessage,
    signal: AbortSignal | undefined,
    frame: ReturnType<AgentPiMutableSessionFrame["snapshot"]>,
    turnState: AgentPiTurnState,
    model: NativeModel,
    requestOptions: NativeStreamOptions,
    logicalCacheScope: string,
    sourceOptions: StreamOptions | SimpleStreamOptions | undefined,
  ): Promise<AssistantMessage> {
    const focus = inspectAgentResidentSpeechFocus(message);
    if (!focus) return message;
    if (
      !shouldProjectResidentSpeech({
        focus,
        prefaceRewriteEnabled: frame.prefaceRewriteEnabled,
        roleplayPresetActive: frame.roleplayPresetActive,
        hasRegisteredToolCalls: turnState.hasRegisteredToolCalls(),
      })
    ) {
      return message;
    }
    if (!this.options.residentSpeech) {
      throw new Error("Active roleplay speech projection requires the resident-speech sidecar.");
    }
    const bridge = context.tools?.find((tool) => tool.name === AgentPiNativeToolBridgeName);
    if (!bridge) {
      throw new Error(`Resident speech continuation requires the ${AgentPiNativeToolBridgeName} bridge tool.`);
    }
    const sidecarCache = createAgentPiPromptCacheOptions({
      phase: focus.mode === "action_preface" ? "resident-speech-action-preface" : "resident-speech-final-response",
      sessionId: requireAgentPiPromptCacheSessionId(frame.sessionId),
      logicalCacheScope,
      model: { provider: model.provider, api: model.api, model: model.id },
      stablePrefix: {
        systemPrompt: context.systemPrompt ?? "",
        tools: [{ name: bridge.name, description: bridge.description, parameters: bridge.parameters }],
      },
    });
    const sidecarStrategy = resolveAgentPromptCacheStrategy(model.api);
    const sidecarRetention = projectAgentPromptCacheRetention(sidecarStrategy, sidecarCache.retention);
    const sidecarWireCapture = createAgentPromptWireCapture({
      fetch: sourceOptions?.fetch,
      onPayload: sourceOptions?.onPayload,
    });
    const sidecarRequestOptions: NativeStreamOptions = {
      ...requestOptions,
      sessionId: sidecarCache.scope,
      cacheRetention: sidecarRetention,
      fetch: sidecarWireCapture.fetch,
      onPayload: sidecarWireCapture.onPayload,
    };
    const sidecarUsage = new AgentModelUsageLedger();
    const recordResidentUsage = createAgentResidentSpeechUsageSink(turnState.context);
    const continuation: AgentResidentSpeechNativeContinuation = {
      stream: ({
        context: continuationContext,
        requiredToolName,
        toolChoice = "required",
        signal: continuationSignal,
      }) =>
        this.delegate(
          model,
          continuationContext,
          {
            ...sidecarRequestOptions,
            signal: continuationSignal,
            toolChoice:
              toolChoice === "required" ? projectAgentNativeRequiredToolChoice(model.api, requiredToolName) : "auto",
          },
          true,
        ),
    };
    let projected: AssistantMessage;
    try {
      projected = await this.options.residentSpeech.project({
        context,
        message,
        focus,
        spokenUtterances: turnState.residentSpeechHistory(),
        enabled: true,
        signal,
        sessionId: requireAgentPiPromptCacheSessionId(frame.sessionId),
        logicalCacheScope,
        nativeContinuation: continuation,
        usageSink: (usage) => {
          sidecarUsage.record(usage);
          recordResidentUsage(usage);
        },
        timingSink: (timing) =>
          emitAgentPiDiagnostic(frame.diagnostics, {
            context: { sessionId: frame.sessionId, requestId: frame.requestId, step: frame.step },
            source: AgentPiDiagnosticSources.Provider,
            name: "model_timing",
            details: timing,
          }),
        inputBudget: turnState.context.tokenBudget,
      });
    } finally {
      const usage = sidecarUsage.aggregate();
      await this.emitPromptCacheObservation(frame, model, sidecarCache, sidecarWireCapture, {
        sessionId: requireAgentPiPromptCacheSessionId(frame.sessionId),
        logicalCacheScope,
        retention: sidecarRetention,
        stablePrefixRevision: sidecarCache.stablePrefixRevision ?? "",
        stablePrefixBytes: sidecarCache.stablePrefixBytes ?? 0,
        usage: {
          cacheRead: usage?.cacheReadTokens ?? 0,
          cacheWrite: usage?.cacheWriteTokens ?? 0,
        },
      });
    }
    const projectedFocus = inspectAgentResidentSpeechFocus(projected);
    if (!projectedFocus) throw new Error("Resident speech projection returned no visible utterance.");
    turnState.recordResidentSpeech({ mode: focus.mode, content: projectedFocus.draft });
    return projected;
  }

  private recordUsage(turnState: AgentPiTurnState, usage: AssistantMessage["usage"]): void {
    const value: AgentModelUsageValue = {
      source: AgentModelUsageSources.ProviderReported,
      inputTokens: usage.input,
      outputTokens: usage.output,
      totalTokens: usage.totalTokens,
      cacheReadTokens: usage.cacheRead,
      cacheWriteTokens: usage.cacheWrite,
      reasoningTokens: usage.reasoning,
    };
    turnState.context.usageLedger.record({ stage: "pi.native.tool_calling", usage: value });
    turnState.context.tokenBudget.recordProviderInputTokens(usage.input + usage.cacheRead + usage.cacheWrite);
  }

  private async emitPromptCacheObservation(
    frame: ReturnType<AgentPiMutableSessionFrame["snapshot"]>,
    model: NativeModel,
    cache: ReturnType<typeof createAgentPiPromptCacheOptions>,
    capture: ReturnType<typeof createAgentPromptWireCapture>,
    input: {
      readonly sessionId: string;
      readonly logicalCacheScope: string;
      readonly retention: NonNullable<SimpleStreamOptions["cacheRetention"]>;
      readonly stablePrefixRevision: string;
      readonly stablePrefixBytes: number;
      readonly usage: Pick<AssistantMessage["usage"], "cacheRead" | "cacheWrite">;
    },
  ): Promise<void> {
    const observation = resolveAgentPromptCacheObservation(resolveAgentPromptCacheStrategy(model.api), input.usage);
    const snapshot = capture.snapshot({
      model,
      sessionId: input.sessionId,
      logicalCacheScope: input.logicalCacheScope,
      providerCacheScope: cache.scope,
      stablePrefixRevision: input.stablePrefixRevision,
      stablePrefixBytes: input.stablePrefixBytes,
      retention: input.retention,
      observation,
      usage: input.usage,
    });
    await emitAgentPiDiagnostic(frame.diagnostics, {
      context: { sessionId: frame.sessionId, requestId: frame.requestId, step: frame.step },
      source: AgentPiDiagnosticSources.Provider,
      name: "prompt_cache",
      details: snapshot,
    });
  }

  private fail(
    output: AssistantMessageEventStream,
    model: NativeModel,
    error: unknown,
    started = false,
    aborted = false,
  ): void {
    const normalized = aborted ? error : normalizeModelHttpError(this.options.modelProvider, error);
    const failed = createFailureMessage(model, normalized, aborted);
    if (!started) output.push({ type: "start", partial: { ...failed, stopReason: "pending" } });
    output.push({ type: "error", reason: failed.stopReason === "aborted" ? "aborted" : "error", error: failed });
    output.end(failed);
  }

  private get apiStreams(): AgentNativeToolApiStreamMap {
    return this.options.apiStreams ?? AgentNativeToolApiStreams;
  }
}

function asNativeModel(
  model: AgentPiProviderProjection["model"] | Model<Api>,
  streams: AgentNativeToolApiStreamMap,
): NativeModel {
  if (!(model.api in streams)) {
    throw new Error(`Pi native tool provider received unsupported API: ${model.api}.`);
  }
  return model as NativeModel;
}

function projectExplicitToolChoiceOptions(model: NativeModel, options: NativeStreamOptions): StreamOptions {
  const reasoning = options.reasoning;
  const reasoningEffort =
    reasoning && (model.api === "openai-responses" || model.api === "openai-completions")
      ? clampThinkingLevel(model, reasoning)
      : undefined;
  return {
    ...options,
    ...(reasoningEffort ? { reasoningEffort } : {}),
  } as StreamOptions;
}

function isFirstTokenEvent(event: AssistantMessageEvent): boolean {
  return (
    event.type === "text_delta" ||
    event.type === "thinking_delta" ||
    event.type === "toolcall_delta" ||
    event.type === "done" ||
    event.type === "error"
  );
}

function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  return AbortSignal.any(signals.filter((signal): signal is AbortSignal => signal !== undefined));
}

function startTimeout(
  controller: AbortController,
  timeoutMs: number,
  kind: "first_token" | "max_request",
): { clear(): void } | undefined {
  if (timeoutMs === -1) return undefined;
  const timer = setTimeout(() => controller.abort(new ModelRequestTimeoutError(kind)), timeoutMs);
  return { clear: () => clearTimeout(timer) };
}

function createFailureMessage(model: NativeModel, error: unknown, aborted: boolean): AssistantMessage {
  return {
    role: "assistant",
    api: model.api,
    provider: model.provider,
    model: model.id,
    content: [],
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: aborted ? "aborted" : "error",
    errorMessage: errorMessage(error),
    timestamp: Date.now(),
  };
}
