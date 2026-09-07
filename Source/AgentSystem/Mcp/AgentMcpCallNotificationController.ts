import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createOpaqueId } from "../Core/AgentIds.js";
import { AgentMcpProtocol } from "./AgentMcpProtocol.js";
import {
  AgentMcpTaskEventNotificationSchema,
  AgentMcpTaskEventsReadResultSchema,
  supportsAgentMcpTaskEvents,
  type AgentMcpTaskEvent,
} from "./AgentMcpTaskEventProtocol.js";
import { AgentMcpToolOutputNotificationSchema } from "./AgentMcpToolOutputProtocol.js";
import {
  AgentMcpTaskEventCapabilityError,
  AgentMcpTaskEventGapError,
  type AgentMcpTaskEventCursor,
  type AgentMcpToolCallOptions,
  type AgentMcpToolClientOptions,
} from "./AgentMcpToolClientContracts.js";
import { agentMcpTaskControlOptions } from "./AgentMcpToolClientRequestPolicy.js";

export interface AgentMcpCallNotificationScope {
  readonly outputToken?: string;
  readonly progressToken?: string;
  close(): void;
}

interface AgentMcpTaskEventDeliveryState {
  readonly cursor: AgentMcpTaskEventCursor;
  readonly pending: Map<number, AgentMcpTaskEvent>;
  readonly onOutput?: AgentMcpToolCallOptions["onOutput"];
  readonly onProgress?: AgentMcpToolCallOptions["onProgress"];
}

export class AgentMcpCallNotificationController {
  private readonly outputHandlers = new Map<string, NonNullable<AgentMcpToolCallOptions["onOutput"]>>();
  private readonly taskEventHandlers = new Map<string, AgentMcpTaskEventDeliveryState>();

  constructor(
    private readonly client: Client,
    private readonly options: AgentMcpToolClientOptions,
  ) {
    client.setNotificationHandler(AgentMcpToolOutputNotificationSchema, (notification) => {
      const output = notification.params;
      this.outputHandlers.get(output.outputToken)?.(output);
    });
    client.setNotificationHandler(AgentMcpTaskEventNotificationSchema, (notification) => {
      const { event, outputToken, progressToken } = notification.params;
      const state = this.readTaskEventState(outputToken, progressToken);
      if (state) deliverTaskEvent(state, event);
    });
  }

  open(options: AgentMcpToolCallOptions): AgentMcpCallNotificationScope {
    this.assertTaskEventCapability(options);
    const outputToken = options.onOutput ? createOpaqueId("mcp_output") : undefined;
    const progressToken = options.resumableEvents && options.onProgress ? createOpaqueId("mcp_progress") : undefined;
    const taskEventState = options.resumableEvents ? createTaskEventDeliveryState(options) : undefined;
    if (outputToken && options.onOutput) this.outputHandlers.set(outputToken, options.onOutput);
    this.registerTaskEventState(taskEventState, outputToken, progressToken);
    return {
      outputToken,
      progressToken,
      close: () => {
        if (outputToken) this.outputHandlers.delete(outputToken);
        this.unregisterTaskEventState(taskEventState, outputToken, progressToken);
      },
    };
  }

  async replay(taskId: string, options: AgentMcpToolCallOptions, deadline: number): Promise<void> {
    if (!options.resumableEvents) return;
    this.assertTaskEventCapability(options);
    const state = createTaskEventDeliveryState(options);
    for (;;) {
      const pageStartCursor = state.cursor.value;
      const response = await this.client.request(
        {
          method: AgentMcpProtocol.taskEvents.read,
          params: {
            taskId,
            afterCursor: state.cursor.value,
            limit: AgentMcpProtocol.taskEvents.pageLimit,
          },
        },
        AgentMcpTaskEventsReadResultSchema,
        agentMcpTaskControlOptions(this.options, options.signal, deadline),
      );
      for (const event of response.events) deliverTaskEvent(state, event);
      if (state.cursor.value !== response.nextCursor) {
        throw new AgentMcpTaskEventGapError(taskId, state.cursor.value, response.nextCursor);
      }
      if (!response.hasMore) return;
      if (response.nextCursor <= pageStartCursor) {
        throw new Error(`MCP task event replay did not advance beyond cursor ${pageStartCursor}.`);
      }
    }
  }

  private assertTaskEventCapability(options: AgentMcpToolCallOptions): void {
    if (!options.resumableEvents) return;
    if (!supportsAgentMcpTaskEvents(this.client.getServerCapabilities())) {
      throw new AgentMcpTaskEventCapabilityError(this.options.server.id);
    }
  }

  private registerTaskEventState(
    state: AgentMcpTaskEventDeliveryState | undefined,
    ...tokens: Array<string | undefined>
  ): void {
    if (!state) return;
    for (const token of tokens) if (token) this.taskEventHandlers.set(token, state);
  }

  private unregisterTaskEventState(
    state: AgentMcpTaskEventDeliveryState | undefined,
    ...tokens: Array<string | undefined>
  ): void {
    if (!state) return;
    for (const token of tokens) {
      if (token && this.taskEventHandlers.get(token) === state) this.taskEventHandlers.delete(token);
    }
  }

  private readTaskEventState(
    outputToken: string | undefined,
    progressToken: string | undefined,
  ): AgentMcpTaskEventDeliveryState | undefined {
    return (
      (outputToken ? this.taskEventHandlers.get(outputToken) : undefined) ??
      (progressToken ? this.taskEventHandlers.get(progressToken) : undefined)
    );
  }
}

function createTaskEventDeliveryState(options: AgentMcpToolCallOptions): AgentMcpTaskEventDeliveryState {
  return {
    cursor: options.taskEventCursor ?? { value: 0 },
    pending: new Map(),
    onOutput: options.onOutput,
    onProgress: options.onProgress,
  };
}

function deliverTaskEvent(state: AgentMcpTaskEventDeliveryState, event: AgentMcpTaskEvent): void {
  if (event.cursor <= state.cursor.value) return;
  state.pending.set(event.cursor, event);
  for (;;) {
    const cursor = state.cursor.value + 1;
    const next = state.pending.get(cursor);
    if (!next) return;
    state.pending.delete(cursor);
    if (next.kind === "output") {
      state.onOutput?.(next.output);
    } else {
      state.onProgress?.({
        progress: next.progress.completed,
        total: next.progress.total,
        message: next.progress.message,
      });
    }
    state.cursor.value = cursor;
  }
}
