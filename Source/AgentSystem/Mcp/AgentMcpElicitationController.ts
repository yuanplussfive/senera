import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { RequestTaskStore } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  ElicitationCompleteNotificationSchema,
  ElicitRequestSchema,
  ErrorCode,
  McpError,
  type ElicitRequestURLParams,
  type ElicitResult,
} from "@modelcontextprotocol/sdk/types.js";
import { createOpaqueId } from "../Core/AgentIds.js";
import { AgentKeyedLeaseQueue } from "../Core/AgentKeyedLeaseQueue.js";
import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { AgentInteractionInputRuntime } from "../Interaction/AgentInteractionInputRuntime.js";
import {
  AgentInteractionInputModes,
  type AgentInteractionInputOwner,
  type AgentInteractionInputSchema,
} from "../Interaction/AgentInteractionInputTypes.js";
import { AgentMcpUrlElicitationDeclinedError, type AgentMcpToolCallOptions } from "./AgentMcpToolClientContracts.js";

interface AgentMcpActiveInteraction {
  readonly owner: AgentInteractionInputOwner;
  readonly signal?: AbortSignal;
  readonly onEvent?: AgentEventSink;
}

export class AgentMcpElicitationController {
  private readonly externalInteractionNamespace = createOpaqueId("mcp_elicitation_scope");
  private readonly lease = new AgentKeyedLeaseQueue<"elicitation">();
  private activeInteraction?: AgentMcpActiveInteraction;

  constructor(
    private readonly client: Client,
    private readonly interactionInput?: AgentInteractionInputRuntime,
  ) {
    if (!interactionInput) return;
    client.setNotificationHandler(ElicitationCompleteNotificationSchema, (notification) => {
      void interactionInput
        .completeExternal(this.externalInteractionId(notification.params.elicitationId))
        .catch((error) => reportAgentMcpBackgroundError(client, error));
    });
    client.setRequestHandler(ElicitRequestSchema, async (request, extra) => {
      const params = request.params;
      const interaction = this.activeInteraction;
      if (!interaction) {
        throw new McpError(ErrorCode.InvalidRequest, "MCP elicitation has no active Senera tool-call owner.");
      }
      const resolve = () =>
        "requestedSchema" in params
          ? resolveFormElicitation(interactionInput, interaction, {
              message: params.message,
              schema: params.requestedSchema as AgentInteractionInputSchema,
            })
          : resolveUrlElicitation(interactionInput, interaction, {
              externalId: this.externalInteractionId(params.elicitationId),
              message: params.message,
              url: params.url,
            });
      if (!params.task) return resolve();
      if (!extra.taskStore) {
        throw new McpError(ErrorCode.InternalError, "MCP client task storage is unavailable for elicitation.");
      }
      const task = await extra.taskStore.createTask({ ttl: extra.taskRequestedTtl });
      void settleElicitationTask(extra.taskStore, task.taskId, resolve()).catch((error) => {
        reportAgentMcpBackgroundError(client, error);
      });
      return { task };
    });
  }

  run<TValue>(options: AgentMcpToolCallOptions, operation: () => Promise<TValue>): Promise<TValue> {
    if (!this.interactionInput) return operation();
    const owner = options.interactionOwner;
    if (!owner) throw new Error("An elicitation-enabled MCP call requires an interaction owner.");
    return this.lease.run(
      "elicitation",
      async () => {
        this.activeInteraction = { owner, signal: options.signal, onEvent: options.interactionEventSink };
        try {
          return await operation();
        } finally {
          this.activeInteraction = undefined;
        }
      },
      options.signal,
    );
  }

  async resolveRequiredUrls(
    requests: readonly ElicitRequestURLParams[],
    options: AgentMcpToolCallOptions,
  ): Promise<void> {
    const interactionInput = this.interactionInput;
    const interaction = this.activeInteraction;
    if (!interactionInput || !interaction) {
      throw new Error("MCP URL elicitation recovery requires an active Senera interaction owner.");
    }
    for (const request of requests) {
      const handle = interactionInput.requestExternal({
        owner: interaction.owner,
        mode: AgentInteractionInputModes.Url,
        externalId: this.externalInteractionId(request.elicitationId),
        message: request.message,
        url: request.url,
        signal: options.signal,
        onEvent: interaction.onEvent,
      });
      const response = await handle.response;
      if (response.action !== "accept") {
        throw new AgentMcpUrlElicitationDeclinedError(request.elicitationId, response.action);
      }
      if ((await handle.completion) !== "completed") {
        throw new AgentMcpUrlElicitationDeclinedError(request.elicitationId, "cancel");
      }
    }
  }

  private externalInteractionId(elicitationId: string): string {
    return `${this.externalInteractionNamespace}:${elicitationId}`;
  }
}

export function reportAgentMcpBackgroundError(client: Pick<Client, "onerror">, error: unknown): void {
  try {
    client.onerror?.(error instanceof Error ? error : new Error(String(error)));
  } catch {
    // Error reporting must not create a second unhandled background rejection.
  }
}

async function resolveFormElicitation(
  interactionInput: AgentInteractionInputRuntime,
  interaction: AgentMcpActiveInteraction,
  request: { message: string; schema: AgentInteractionInputSchema },
): Promise<ElicitResult> {
  const resolution = await interactionInput.request({
    owner: interaction.owner,
    mode: AgentInteractionInputModes.Form,
    message: request.message,
    schema: request.schema,
    signal: interaction.signal,
    onEvent: interaction.onEvent,
  });
  return { action: resolution.action, ...(resolution.content ? { content: resolution.content } : {}) };
}

async function resolveUrlElicitation(
  interactionInput: AgentInteractionInputRuntime,
  interaction: AgentMcpActiveInteraction,
  request: { externalId: string; message: string; url: string },
): Promise<ElicitResult> {
  const resolution = await interactionInput.request({
    owner: interaction.owner,
    mode: AgentInteractionInputModes.Url,
    externalId: request.externalId,
    message: request.message,
    url: request.url,
    signal: interaction.signal,
    onEvent: interaction.onEvent,
  });
  return { action: resolution.action };
}

async function settleElicitationTask(
  taskStore: RequestTaskStore,
  taskId: string,
  resolution: Promise<ElicitResult>,
): Promise<void> {
  try {
    await taskStore.storeTaskResult(taskId, "completed", await resolution);
  } catch {
    await taskStore.storeTaskResult(taskId, "failed", { action: "cancel" });
  }
}
