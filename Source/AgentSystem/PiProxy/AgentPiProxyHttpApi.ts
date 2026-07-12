import type http from "node:http";
import { z } from "zod";
import { AgentEventKinds, type AgentEventSink } from "../Events/AgentEvent.js";
import { resolveActionPlannerConfig, resolveModelProviderConfig } from "../AgentDefaults.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { AgentPiAssistantCompiler, type AgentPiAssistantCompilerPort } from "./AgentPiAssistantCompiler.js";
import { PiOpenAiChatCompletionRequestSchema } from "./AgentPiOpenAiWireTypes.js";
import {
  AgentPiProxyContextHeader,
  registerPiProxyToolCallBatch,
  readPiProxyRuntimeContext,
} from "./AgentPiProxyRuntimeContext.js";
import { createAssistantMessageId, createToolBatchId } from "../Core/AgentIds.js";
import { createPiTraceEvent } from "../Pi/AgentPiTraceProjector.js";
import {
  projectPiChatCompletionResponse,
  projectPiChatCompletionStreamEvents,
  projectPiModelsResponse,
} from "./AgentPiOpenAiResponseProjector.js";
import { AgentPiProxyProtocol } from "./AgentPiProxyContract.js";

export interface AgentPiProxyHttpApiOptions {
  configSnapshot: () => AgentSystemConfig;
  compilerFactory?: (config: AgentSystemConfig) => AgentPiAssistantCompilerPort;
  onEvent?: AgentEventSink;
  maxRequestBytes?: number;
}

type RouteHandler = (request: http.IncomingMessage, response: http.ServerResponse) => Promise<void>;

export class AgentPiProxyHttpApi {
  private readonly routes = new Map<string, RouteHandler>([
    [`GET ${AgentPiProxyProtocol.routes.models}`, (_request, response) => this.handleModels(response)],
    [
      `POST ${AgentPiProxyProtocol.routes.chatCompletions}`,
      (request, response) => this.handleChatCompletions(request, response),
    ],
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
      const status = error instanceof PiProxyRequestTooLargeError ? 413 : 500;
      const code = error instanceof PiProxyRequestTooLargeError ? "request_too_large" : "senera_pi_proxy_error";
      writeJson(response, status, openAiError(code, errorMessage(error)));
    }
  }

  private async handleModels(response: http.ServerResponse): Promise<void> {
    writeJson(response, 200, projectPiModelsResponse(this.modelId()));
  }

  private async handleChatCompletions(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const payload = PiOpenAiChatCompletionRequestSchema.parse(
      await readJsonBody(request, this.options.maxRequestBytes ?? 1_048_576),
    );
    const compiler = this.compiler();
    const runtime = readPiProxyRuntimeContext(readSingleHeader(request.headers[AgentPiProxyContextHeader]));
    await this.emitProxyTrace(runtime, "request", {
      model: payload.model,
      stream: payload.stream === true,
      messageCount: payload.messages.length,
      toolCount: payload.tools?.length ?? 0,
      toolChoice: payload.tool_choice,
    });
    const assistantMessage = await compiler.compile({
      request: payload,
      runtime,
    });
    await this.emitProxyTrace(runtime, "compiled", {
      kind: assistantMessage.kind,
      contentChars: assistantMessage.content.length,
      toolCalls: assistantMessage.toolCalls.map((call) => ({
        name: call.name,
        argumentKeys: Object.keys(call.arguments),
      })),
    });
    await this.emitAssistantVisibleEvents(runtime, assistantMessage, payload);

    if (payload.stream === true) {
      writeSse(response, projectPiChatCompletionStreamEvents(payload.model, assistantMessage));
      return;
    }

    writeJson(response, 200, projectPiChatCompletionResponse(payload.model, assistantMessage));
  }

  private compiler(): AgentPiAssistantCompilerPort {
    const config = this.options.configSnapshot();
    if (this.options.compilerFactory) {
      return this.options.compilerFactory(config);
    }
    const provider = resolveModelProviderConfig(config);
    return new AgentPiAssistantCompiler({
      modelProvider: provider,
      actionPlannerConfig: resolveActionPlannerConfig(config, provider.Id),
    });
  }

  private modelId(): string {
    return resolveModelProviderConfig(this.options.configSnapshot()).Model;
  }

  private async emitProxyTrace(
    runtime: ReturnType<typeof readPiProxyRuntimeContext>,
    eventType: string,
    payload: unknown,
  ): Promise<void> {
    const sink = runtime?.onEvent ?? this.options.onEvent;
    await sink?.(
      createPiTraceEvent({
        sessionId: runtime?.sessionId,
        requestId: runtime?.requestId ?? "pi-proxy",
        step: runtime?.step ?? 0,
        source: "proxy",
        eventType,
        payload,
      }),
    );
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
}

function readSingleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function routeKey(request: http.IncomingMessage): string {
  const method = request.method?.toUpperCase() ?? "";
  const path = request.url ? new URL(request.url, "http://senera.local").pathname : "";
  return `${method} ${path}`;
}

class PiProxyRequestTooLargeError extends Error {
  constructor() {
    super("Request body exceeds the configured limit.");
  }
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

function writeSse(response: http.ServerResponse, events: readonly unknown[]): void {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  for (const event of events) {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  response.end("data: [DONE]\n\n");
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

function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => issue.message).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}
