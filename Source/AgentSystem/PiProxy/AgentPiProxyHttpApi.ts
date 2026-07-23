import type http from "node:http";
import { z } from "zod";
import { AgentEventKinds, type AgentEventSink } from "../Events/AgentEvent.js";
import {
  resolveActionPlannerConfig,
  resolveModelProviderCatalog,
  resolveModelProviderConfig,
  resolveServerConfig,
} from "../AgentDefaults.js";
import type { AgentSystemConfig, ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import {
  AgentPiAssistantCompiler,
  type AgentPiAssistantCompileRequest,
  type AgentPiAssistantCompilerPort,
} from "./AgentPiAssistantCompiler.js";
import { PiOpenAiChatCompletionRequestSchema } from "./AgentPiOpenAiWireTypes.js";
import {
  AgentPiProxyContextHeader,
  AgentPiProxyModelProviderHeader,
  decodePiProxyModelProviderHeaderValue,
  registerPiProxyToolCallBatch,
  readPiProxyRuntimeContext,
} from "./AgentPiProxyRuntimeContext.js";
import { createAssistantMessageId, createToolBatchId } from "../Core/AgentIds.js";
import {
  AgentPiDiagnosticSources,
  emitAgentPiDiagnostic,
  type AgentPiDiagnosticSink,
} from "../Pi/AgentPiDiagnostics.js";
import { projectPiModelsResponse } from "./AgentPiOpenAiResponseProjector.js";
import { AgentPiFinalAnswerGenerator, type AgentPiFinalAnswerGeneratorPort } from "./AgentPiFinalAnswerGenerator.js";
import { createAgentPiOpenAiResponseWriter } from "./AgentPiOpenAiResponseWriter.js";
import type { AgentPiAssistantCompilation, AgentPiAssistantMessage } from "./AgentPiAssistantMessageTypes.js";
import { AgentModelUsageLedger, type AgentModelUsageSink } from "../ModelEndpoints/AgentModelUsage.js";
import type { AgentModelTimingSink } from "../ModelEndpoints/AgentModelTiming.js";

export interface AgentPiProxyHttpApiOptions {
  configSnapshot: () => AgentSystemConfig;
  compilerFactory?: (
    config: AgentSystemConfig,
    modelProvider: ResolvedAgentModelProviderConfig,
    usageSink?: AgentModelUsageSink,
    timingSink?: AgentModelTimingSink,
  ) => AgentPiAssistantCompilerPort;
  finalAnswerGeneratorFactory?: (
    config: AgentSystemConfig,
    modelProvider: ResolvedAgentModelProviderConfig,
    usageSink?: AgentModelUsageSink,
    timingSink?: AgentModelTimingSink,
  ) => AgentPiFinalAnswerGeneratorPort;
  onEvent?: AgentEventSink;
  diagnostics?: AgentPiDiagnosticSink;
  maxRequestBytes?: number;
}

type RouteHandler = (request: http.IncomingMessage, response: http.ServerResponse) => Promise<void>;

class AgentPiProxyRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
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
      writeJson(response, proxyError.status, openAiError(proxyError.code, proxyError.message));
    }
  }

  private async handleModels(response: http.ServerResponse): Promise<void> {
    writeJson(response, 200, projectPiModelsResponse(this.modelId()));
  }

  private async handleChatCompletions(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const config = this.options.configSnapshot();
    const payload = PiOpenAiChatCompletionRequestSchema.parse(
      await readJsonBody(request, this.options.maxRequestBytes ?? resolveServerConfig(config).RequestMaxBytes),
    );
    const provider = resolvePiProxyModelProvider(
      config,
      readSingleHeader(request.headers[AgentPiProxyModelProviderHeader]),
    );
    const runtime = readPiProxyRuntimeContext(readSingleHeader(request.headers[AgentPiProxyContextHeader]));
    const requestUsage = new AgentModelUsageLedger();
    const usageSink: AgentModelUsageSink = (call) => {
      requestUsage.record(call);
      runtime?.usageLedger?.record(call);
    };
    const timingSink: AgentModelTimingSink = (timing) => this.emitProxyDiagnostic(runtime, "model_timing", timing);
    const compiler = this.compiler(config, provider, usageSink, timingSink);
    const finalAnswers = this.finalAnswerGenerator(config, provider, usageSink, timingSink);
    const lifetime = new AgentPiProxyRequestLifetime(request, response);
    const requestStartedAt = performance.now();
    try {
      await this.emitProxyDiagnostic(runtime, "provider_request", {
        model: payload.model,
        stream: payload.stream === true,
        messageCount: payload.messages.length,
        toolCount: payload.tools?.length ?? 0,
        toolChoice: payload.tool_choice,
      });
      const compilation = await compiler.compile({
        request: payload,
        runtime,
        signal: lifetime.signal,
      });
      await this.emitProxyDiagnostic(runtime, "provider_response", {
        ...projectCompilationTrace(compilation),
        durationMs: Math.round(performance.now() - requestStartedAt),
      });
      await this.emitCompilationVisibleEvents(runtime, compilation, payload);

      const writer = createAgentPiOpenAiResponseWriter({
        response,
        model: payload.model,
        streaming: payload.stream === true,
        usage: () => requestUsage.contextUsage(),
        onFirstOutput: () =>
          this.emitProxyDiagnostic(runtime, "first_output", {
            durationMs: Math.round(performance.now() - requestStartedAt),
            streaming: payload.stream === true,
          }),
      });
      const assistantMessage = await this.writeCompilation({
        compilation,
        writer,
        finalAnswers,
        compileRequest: { request: payload, runtime, signal: lifetime.signal },
      });
      await this.emitProxyDiagnostic(runtime, "completed", {
        kind: assistantMessage.kind,
        contentChars: assistantMessage.content.length,
        toolCallCount: assistantMessage.toolCalls.length,
      });
    } finally {
      lifetime.dispose();
    }
  }

  private compiler(
    config: AgentSystemConfig,
    provider: ResolvedAgentModelProviderConfig,
    usageSink: AgentModelUsageSink,
    timingSink: AgentModelTimingSink,
  ): AgentPiAssistantCompilerPort {
    if (this.options.compilerFactory) {
      return this.options.compilerFactory(config, provider, usageSink, timingSink);
    }
    return new AgentPiAssistantCompiler({
      modelProvider: provider,
      actionPlannerConfig: resolveActionPlannerConfig(config, provider.Id),
      usageSink,
      timingSink,
    });
  }

  private finalAnswerGenerator(
    config: AgentSystemConfig,
    provider: ResolvedAgentModelProviderConfig,
    usageSink: AgentModelUsageSink,
    timingSink: AgentModelTimingSink,
  ): AgentPiFinalAnswerGeneratorPort {
    if (this.options.finalAnswerGeneratorFactory) {
      return this.options.finalAnswerGeneratorFactory(config, provider, usageSink, timingSink);
    }
    return new AgentPiFinalAnswerGenerator(
      provider,
      resolveActionPlannerConfig(config, provider.Id).FinalAnswerClient,
      usageSink,
      timingSink,
    );
  }

  private async writeCompilation(options: {
    compilation: AgentPiAssistantCompilation;
    writer: ReturnType<typeof createAgentPiOpenAiResponseWriter>;
    finalAnswers: AgentPiFinalAnswerGeneratorPort;
    compileRequest: AgentPiAssistantCompileRequest;
  }): Promise<AgentPiAssistantMessage> {
    if (options.compilation.kind !== "final_answer") {
      await options.writer.writeMessage(options.compilation);
      return options.compilation;
    }

    const runtime = options.compileRequest.runtime;
    const stream = await options.finalAnswers.stream(options.compilation.input, {
      requestId: runtime?.requestId ?? "pi-final-answer",
      step: runtime?.step ?? 0,
      signal: options.compileRequest.signal,
    });
    const content = await options.writer.writeFinalAnswer(stream);
    return { kind: "final_text", content, toolCalls: [] };
  }

  private modelId(): string {
    return resolveModelProviderConfig(this.options.configSnapshot()).Model;
  }

  private async emitProxyDiagnostic(
    runtime: ReturnType<typeof readPiProxyRuntimeContext>,
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
    runtime: ReturnType<typeof readPiProxyRuntimeContext>,
    assistantMessage: Awaited<ReturnType<AgentPiAssistantCompilerPort["compile"]>>,
    payload: z.infer<typeof PiOpenAiChatCompletionRequestSchema>,
  ): Promise<void> {
    const sink = runtime?.onEvent ?? this.options.onEvent;
    if (!sink || !runtime?.requestId || assistantMessage.kind !== "tool_calls") {
      return;
    }

    const step = runtime.step ?? 0;
    const content = assistantMessage.content.trim();
    const batchId = createToolBatchId();
    registerPiProxyToolCallBatch(
      runtime,
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
        executionMode: payload.parallel_tool_calls === false ? "sequential" : "parallel",
        batchId,
        reason: content || undefined,
      },
    });
  }

  private emitCompilationVisibleEvents(
    runtime: ReturnType<typeof readPiProxyRuntimeContext>,
    compilation: AgentPiAssistantCompilation,
    payload: z.infer<typeof PiOpenAiChatCompletionRequestSchema>,
  ): Promise<void> {
    return compilation.kind === "final_answer"
      ? Promise.resolve()
      : this.emitAssistantVisibleEvents(runtime, compilation, payload);
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
    return resolveModelProviderConfig(config);
  }

  const modelProviderId = decodePiProxyModelProviderHeaderValue(modelProviderHeader).trim();
  if (!modelProviderId) {
    throw new AgentPiProxyRequestError("invalid_model_provider", "Pi proxy model provider header must not be empty.");
  }

  const catalog = resolveModelProviderCatalog(config);
  const provider = catalog.providers.find((item) => item.Id === modelProviderId);
  if (!provider) {
    throw new AgentPiProxyRequestError(
      "invalid_model_provider",
      `Pi proxy model provider is not configured: ${modelProviderId}`,
    );
  }

  return provider;
}

function routeKey(request: http.IncomingMessage): string {
  const method = request.method?.toUpperCase() ?? "";
  const path = request.url ? new URL(request.url, "http://senera.local").pathname : "";
  return `${method} ${path}`;
}

async function readJsonBody(request: http.IncomingMessage, maximumBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.length;
    if (receivedBytes > maximumBytes) {
      throw new PiProxyRequestTooLargeError();
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text.trim() ? (JSON.parse(text) as unknown) : {};
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

function toPublicPiProxyError(error: unknown): AgentPiProxyRequestError {
  if (error instanceof AgentPiProxyRequestError) return error;
  if (error instanceof z.ZodError) {
    return new AgentPiProxyRequestError("invalid_request", "Pi proxy request is invalid.");
  }
  return new AgentPiProxyRequestError("senera_pi_proxy_error", "Pi proxy request failed.", 500);
}

export function buildPiProxyBaseUrl(config: AgentSystemConfig): string {
  const server = resolveServerConfig(config);
  return `http://${clientHostForBindHost(server.Host)}:${server.Port}/v1`;
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
  if (compilation.kind === "final_answer") {
    return {
      kind: compilation.kind,
      decisionSource: compilation.decisionSource,
      answerPlanSteps: compilation.input.answerPlan.length,
    };
  }
  return {
    kind: compilation.kind,
    contentChars: compilation.content.length,
    toolCalls: compilation.toolCalls.map((call) => ({
      name: call.name,
      argumentKeys: Object.keys(call.arguments),
    })),
  };
}

function clientHostForBindHost(host: string): string {
  const bindAnyHostByName = new Map([
    ["0.0.0.0", "127.0.0.1"],
    ["::", "[::1]"],
    ["[::]", "[::1]"],
  ]);
  return bindAnyHostByName.get(host) ?? host;
}
