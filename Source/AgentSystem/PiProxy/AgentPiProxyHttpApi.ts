import type http from "node:http";
import { z } from "zod";
import { AgentEventKinds, type AgentEventSink } from "../Events/AgentEvent.js";
import { resolveModelProviderCatalog, resolveServerConfig } from "../AgentDefaults.js";
import type { AgentSystemConfig, ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type { AgentPiAssistantCompilerPort } from "./AgentPiAssistantCompiler.js";
import { PiOpenAiChatCompletionRequestSchema } from "./AgentPiOpenAiWireTypes.js";
import {
  AgentPiProxyContextHeader,
  AgentPiProxyModelProviderHeader,
  decodePiProxyModelProviderHeaderValue,
} from "../PiShared/AgentPiProxyProtocol.js";
import type {
  AgentPiTurnContext,
  AgentPiTurnContextLease,
  AgentPiTurnContextStore,
} from "../PiShared/AgentPiTurnContext.js";
import { createAssistantMessageId, createToolBatchId } from "../Core/AgentIds.js";
import { readStreamJsonBody } from "../Core/AgentJsonParsing.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";
import { AgentPiDiagnosticSources, type AgentPiDiagnosticSink } from "../PiShared/AgentPiDiagnosticsTypes.js";
import { emitAgentPiDiagnostic } from "../Diagnostics/AgentPiDiagnostics.js";
import { projectPiModelsResponse } from "./AgentPiOpenAiResponseProjector.js";
import { createAgentPiOpenAiResponseWriter } from "./AgentPiOpenAiResponseWriter.js";
import type { AgentPiAssistantCompilation } from "../PiShared/AgentPiPlanningTypes.js";
import { AgentModelUsageLedger, type AgentModelUsageSink } from "../ModelEndpoints/AgentModelUsage.js";
import type { AgentModelTimingSink } from "../ModelEndpoints/AgentModelTiming.js";
import type { AgentPiProxyModelFactory } from "./AgentPiProxyModelFactory.js";
import { AgentPiOuterUsageEstimator } from "./AgentPiOuterUsageEstimator.js";

export interface AgentPiProxyHttpApiOptions {
  configSnapshot: () => AgentSystemConfig;
  modelFactory: AgentPiProxyModelFactory;
  onEvent?: AgentEventSink;
  diagnostics?: AgentPiDiagnosticSink;
  maxRequestBytes?: number;
  turnContexts: AgentPiTurnContextStore;
}

type RouteHandler = (request: http.IncomingMessage, response: http.ServerResponse) => Promise<void>;

class AgentPiProxyRequestError extends AgentBaseError {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    options?: ErrorOptions,
    readonly diagnosticContext?: AgentPiTurnContext,
  ) {
    super(message, options);
  }
}

class PiProxyRequestTooLargeError extends AgentPiProxyRequestError {
  constructor() {
    super("request_too_large", "Pi proxy request body exceeds the configured size limit.", 413);
  }
}

export class AgentPiProxyHttpApi {
  private readonly routes = new Map<string, RouteHandler>([
    ["GET /v1/models", (_request, response) => this.handleModels(response)],
    ["POST /v1/chat/completions", (request, response) => this.handleChatCompletions(request, response)],
  ]);

  constructor(private readonly options: AgentPiProxyHttpApiOptions) {}

  canHandle(request: http.IncomingMessage): boolean {
    return this.routes.has(routeKey(request));
  }

  async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const handler = this.routes.get(routeKey(request));
    if (!handler) {
      writeJson(response, 404, openAiError("not_found", "Pi proxy route not found."));
      return;
    }

    try {
      await handler(request, response);
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const proxyError = toPublicPiProxyError(error);
      await this.emitProxyDiagnostic(proxyError.diagnosticContext, "proxy_error", {
        code: proxyError.code,
        status: proxyError.status,
        message: proxyError.message,
        cause: projectDiagnosticErrorCause(proxyError.cause),
      });
      writeJson(response, proxyError.status, openAiError(proxyError.code, proxyError.message));
    }
  }

  private async handleModels(response: http.ServerResponse): Promise<void> {
    const providers = resolveModelProviderCatalog(this.options.configSnapshot()).providers;
    writeJson(response, 200, projectPiModelsResponse(providers.map((provider) => provider.Model)));
  }

  private async handleChatCompletions(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const config = this.options.configSnapshot();
    const payload = PiOpenAiChatCompletionRequestSchema.parse(
      await readStreamJsonBody(request, {
        maximumBytes: this.options.maxRequestBytes ?? resolveServerConfig(config).RequestMaxBytes,
        contextLabel: "Request body",
        onTooLarge: () => new PiProxyRequestTooLargeError(),
      }),
    );
    const provider = resolvePiProxyModelProvider(
      config,
      readSingleHeader(request.headers[AgentPiProxyModelProviderHeader]),
    );
    const { contextId, lease: contextLease } = this.acquireTurnContext(
      readSingleHeader(request.headers[AgentPiProxyContextHeader]),
    );
    const runtime = contextLease.context;
    const lifetime = new AgentPiProxyRequestLifetime(request, response);
    const requestStartedAt = performance.now();
    try {
      const requestUsage = new AgentModelUsageLedger();
      const usageSink: AgentModelUsageSink = (call) => {
        requestUsage.record(call);
        runtime.usageLedger?.record(call);
      };
      const timingSink: AgentModelTimingSink = (timing) => this.emitProxyDiagnostic(runtime, "model_timing", timing);
      const compiler = this.options.modelFactory.createCompiler(config, provider, usageSink, timingSink);
      await this.emitProxyDiagnostic(runtime, "provider_request", {
        model: payload.model,
        stream: payload.stream === true,
        messageCount: payload.messages.length,
        toolCount: payload.tools?.length ?? 0,
        toolChoice: payload.tool_choice,
      });
      const compilation = await compiler.compile({
        request: payload,
        toolAccessGrant: runtime.toolAccessGrant,
        runtime,
        signal: lifetime.signal,
      });
      await this.emitProxyDiagnostic(runtime, "provider_response", {
        ...projectCompilationTrace(compilation),
        durationMs: Math.round(performance.now() - requestStartedAt),
      });
      await this.emitCompilationVisibleEvents(contextId, runtime, compilation, payload);
      const outerUsage = new AgentPiOuterUsageEstimator(payload.model).estimate(payload, compilation);

      const writer = createAgentPiOpenAiResponseWriter({
        response,
        model: payload.model,
        streaming: payload.stream === true,
        usage: () => outerUsage,
        onFirstOutput: () =>
          this.emitProxyDiagnostic(runtime, "first_output", {
            durationMs: Math.round(performance.now() - requestStartedAt),
            streaming: payload.stream === true,
          }),
      });
      await writer.writeMessage(compilation);
      const assistantMessage = compilation;
      await this.emitProxyDiagnostic(runtime, "completed", {
        kind: assistantMessage.kind,
        contentChars: assistantMessage.content.length,
        toolCallCount: assistantMessage.toolCalls.length,
        outerUsage,
        internalUsage: requestUsage.aggregate(),
      });
    } catch (error) {
      throw toPublicPiProxyError(error, runtime);
    } finally {
      lifetime.dispose();
      contextLease.release();
    }
  }

  private acquireTurnContext(contextId: string | undefined): { contextId: string; lease: AgentPiTurnContextLease } {
    const lease = this.options.turnContexts.acquire(contextId);
    if (contextId && lease) return { contextId, lease };
    throw new AgentPiProxyRequestError(
      "invalid_pi_context",
      "Pi proxy turn context is missing, expired, or no longer active.",
    );
  }

  private async emitProxyDiagnostic(
    runtime: AgentPiTurnContext | undefined,
    name: string,
    details: unknown,
  ): Promise<void> {
    await emitAgentPiDiagnostic(runtime?.diagnostics ?? this.options.diagnostics, {
      context: {
        sessionId: runtime?.sessionId,
        requestId: runtime?.requestId,
        step: runtime?.step,
      },
      source: AgentPiDiagnosticSources.Proxy,
      name,
      details,
    });
  }

  private async emitAssistantVisibleEvents(
    contextId: string,
    runtime: AgentPiTurnContext,
    assistantMessage: Awaited<ReturnType<AgentPiAssistantCompilerPort["compile"]>>,
    payload: z.infer<typeof PiOpenAiChatCompletionRequestSchema>,
  ): Promise<void> {
    const sink = runtime.onEvent ?? this.options.onEvent;
    if (!sink || !runtime.requestId || assistantMessage.kind !== "tool_calls") {
      return;
    }

    const step = runtime.step ?? 0;
    const content = assistantMessage.content.trim();
    const batchId = createToolBatchId();
    this.options.turnContexts.registerToolCallBatch(
      contextId,
      batchId,
      assistantMessage.toolCalls.flatMap((call) => (call.id ? [call.id] : [])),
    );

    if (content) {
      await sink({
        kind: AgentEventKinds.AssistantMessageCreated,
        context: {
          sessionId: runtime.sessionId,
          requestId: runtime.requestId,
          step,
        },
        data: {
          messageId: createAssistantMessageId(),
          kind: "tool_preface",
          content,
          terminal: false,
          toolCount: assistantMessage.toolCalls.length,
          batchId,
          toolCallIds: assistantMessage.toolCalls.flatMap((call) => (call.id ? [call.id] : [])),
        },
      });
    }

    if (assistantMessage.toolCalls.length === 0) {
      return;
    }

    await sink({
      kind: AgentEventKinds.ToolCallsPlanned,
      context: {
        sessionId: runtime.sessionId,
        requestId: runtime.requestId,
        step,
      },
      data: {
        toolCount: assistantMessage.toolCalls.length,
        tools: assistantMessage.toolCalls.map((call) => call.name),
        status: "planned",
        executionMode:
          payload.parallel_tool_calls === false || assistantMessage.toolCalls.length < 2 ? "sequential" : "parallel",
        batchId,
        reason: content || undefined,
      },
    });
  }

  private emitCompilationVisibleEvents(
    contextId: string,
    runtime: AgentPiTurnContext,
    compilation: AgentPiAssistantCompilation,
    payload: z.infer<typeof PiOpenAiChatCompletionRequestSchema>,
  ): Promise<void> {
    return this.emitAssistantVisibleEvents(contextId, runtime, compilation, payload);
  }
}

function readSingleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function resolvePiProxyModelProvider(
  config: AgentSystemConfig,
  modelProviderHeader: string | undefined,
): ResolvedAgentModelProviderConfig {
  if (modelProviderHeader === undefined) {
    throw new AgentPiProxyRequestError("invalid_model_provider", "Pi proxy model provider header is required.");
  }

  const modelProviderId = decodePiProxyModelProviderHeaderValue(modelProviderHeader).trim();
  if (!modelProviderId) {
    throw new AgentPiProxyRequestError("invalid_model_provider", "Pi proxy model provider header must not be empty.");
  }

  const catalog = resolveModelProviderCatalog(config);
  try {
    return catalog.resolve(modelProviderId);
  } catch {
    throw new AgentPiProxyRequestError(
      "invalid_model_provider",
      `Pi proxy model provider is not configured: ${modelProviderId}`,
    );
  }
}

function routeKey(request: http.IncomingMessage): string {
  const method = request.method?.toUpperCase() ?? "";
  const path = request.url ? new URL(request.url, "http://senera.local").pathname : "";
  return `${method} ${path}`;
}

function writeJson(response: http.ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function openAiError(code: string, message: string): unknown {
  return {
    error: {
      message,
      type: "senera_pi_proxy_error",
      code,
    },
  };
}

function toPublicPiProxyError(error: unknown, diagnosticContext?: AgentPiTurnContext): AgentPiProxyRequestError {
  if (error instanceof AgentPiProxyRequestError) {
    if (!diagnosticContext || error.diagnosticContext) return error;
    return new AgentPiProxyRequestError(
      error.code,
      error.message,
      error.status,
      { cause: error.cause },
      diagnosticContext,
    );
  }
  if (error instanceof z.ZodError) {
    return new AgentPiProxyRequestError(
      "invalid_request",
      "Pi proxy request is invalid.",
      400,
      { cause: error },
      diagnosticContext,
    );
  }
  return new AgentPiProxyRequestError(
    "senera_pi_proxy_error",
    "Pi proxy request failed.",
    500,
    { cause: error },
    diagnosticContext,
  );
}

/**
 * Projects an error cause into a diagnostic-safe shape.
 *
 * The public client response never includes the original cause (to avoid
 * leaking internals), but the `proxy_error` diagnostic preserves the error
 * name and message so operators can distinguish timeouts, upstream failures,
 * parse errors, etc. instead of seeing only a generic 500.
 */
function projectDiagnosticErrorCause(cause: unknown): { name: string; message: string } | string | undefined {
  if (cause instanceof Error) {
    return { name: cause.name, message: cause.message };
  }
  return typeof cause === "string" ? cause : undefined;
}

class AgentPiProxyRequestLifetime {
  private readonly controller = new AbortController();
  private readonly abort = (): void => this.controller.abort(new Error("Pi proxy client disconnected."));

  constructor(
    private readonly request: http.IncomingMessage,
    private readonly response: http.ServerResponse,
  ) {
    request.once("aborted", this.abort);
    response.once("close", this.abort);
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  dispose(): void {
    this.request.off("aborted", this.abort);
    this.response.off("close", this.abort);
  }
}

function projectCompilationTrace(compilation: AgentPiAssistantCompilation): Record<string, unknown> {
  return {
    kind: compilation.kind,
    contentChars: compilation.content.length,
    toolCalls: compilation.toolCalls.map((call) => ({
      name: call.name,
      argumentKeys: Object.keys(call.arguments),
    })),
  };
}
