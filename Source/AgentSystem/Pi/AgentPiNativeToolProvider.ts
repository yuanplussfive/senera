import {
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
  type AgentNativeRequiredToolChoice,
  type AgentNativeToolApi,
} from "../ModelEndpoints/AgentModelEndpointContract.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { ModelRequestTimeoutError, normalizeModelHttpError } from "../ModelEndpoints/ModelHttpErrors.js";
import { AgentModelUsageSources, type AgentModelUsageValue } from "../ModelEndpoints/AgentModelUsage.js";
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
import { createAgentPiPromptCacheOptions, requireAgentPiPromptCacheSessionId } from "./AgentPiPromptCache.js";
import { projectAgentPiNativeToolCallDisplay } from "./AgentPiNativeToolBridge.js";

type NativeModel = Model<AgentNativeToolApi>;
type NativeStreamOptions = SimpleStreamOptions & {
  readonly toolChoice?: AgentNativeRequiredToolChoice;
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
      const cache = createAgentPiPromptCacheOptions({
        phase: "native-conversation",
        sessionId: frame.sessionId,
        logicalCacheScope: frame.logicalCacheScope ?? options?.sessionId,
        model: { provider: model.provider, api: model.api, model: model.id },
        stablePrefix: {
          systemPrompt: request.systemPrompt,
          tools: request.tools?.map(({ name, description, parameters }) => ({ name, description, parameters })) ?? [],
        },
      });
      const requestOptions: NativeStreamOptions = {
        ...(options ?? {}),
        signal,
        sessionId: cache.scope,
        cacheRetention: cache.retention,
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
            simple,
          );
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
    return simple
      ? streams.streamSimple(model, context, options)
      : streams.stream(model, context, options as StreamOptions);
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
    simple: boolean,
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
    const continuation: AgentResidentSpeechNativeContinuation = {
      stream: ({ context: continuationContext, requiredToolName, signal: continuationSignal }) =>
        this.delegate(
          model,
          continuationContext,
          {
            ...requestOptions,
            signal: continuationSignal,
            toolChoice: projectAgentNativeRequiredToolChoice(model.api, requiredToolName),
          },
          simple,
        ),
    };
    const projected = await this.options.residentSpeech.project({
      context,
      message,
      focus,
      spokenUtterances: turnState.residentSpeechHistory(),
      enabled: true,
      signal,
      sessionId: requireAgentPiPromptCacheSessionId(frame.sessionId),
      nativeContinuation: continuation,
      usageSink: createAgentResidentSpeechUsageSink(turnState.context),
      timingSink: (timing) =>
        emitAgentPiDiagnostic(frame.diagnostics, {
          context: { sessionId: frame.sessionId, requestId: frame.requestId, step: frame.step },
          source: AgentPiDiagnosticSources.Provider,
          name: "model_timing",
          details: timing,
        }),
      inputBudget: turnState.context.tokenBudget,
    });
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
