import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTaskStore } from "@modelcontextprotocol/sdk/experimental/tasks";
import { CreateMessageRequestSchema, UrlElicitationRequiredError } from "@modelcontextprotocol/sdk/types.js";
import { AgentMcpStdioTransport } from "./AgentMcpStdioTransport.js";
import { AgentMcpProtocol } from "./AgentMcpProtocol.js";
import { createAgentMcpToolListChangedHandlers, type AgentMcpToolDeclaration } from "./AgentMcpToolCatalogChange.js";
import { AgentMcpCallNotificationController } from "./AgentMcpCallNotificationController.js";
import { AgentMcpElicitationController, reportAgentMcpBackgroundError } from "./AgentMcpElicitationController.js";
import { AgentMcpTaskController } from "./AgentMcpTaskController.js";
import type { AgentMcpToolCallOptions, AgentMcpToolClientOptions } from "./AgentMcpToolClientContracts.js";
import { agentMcpRequestOptions, preferAgentMcpConnectionFailure } from "./AgentMcpToolClientRequestPolicy.js";

export type {
  AgentMcpTaskEventCursor,
  AgentMcpToolCallCorrelation,
  AgentMcpToolCallOptions,
  AgentMcpToolClientOptions,
  AgentMcpToolOutputEvent,
  AgentMcpToolProgress,
  AgentMcpToolTask,
} from "./AgentMcpToolClientContracts.js";
export {
  AgentMcpTaskCancelledError,
  AgentMcpTaskDetachedError,
  AgentMcpTaskEventCapabilityError,
  AgentMcpTaskEventGapError,
  AgentMcpTaskInputRequiredError,
  AgentMcpUrlElicitationDeclinedError,
} from "./AgentMcpToolClientContracts.js";

export async function withAgentMcpToolClient<TValue>(
  options: AgentMcpToolClientOptions,
  operation: (client: AgentMcpToolClient) => Promise<TValue>,
): Promise<TValue> {
  const toolClient = await openAgentMcpToolClient(options);
  try {
    return await operation(toolClient);
  } finally {
    await toolClient.close();
  }
}

export async function openAgentMcpToolClient(options: AgentMcpToolClientOptions): Promise<AgentMcpToolClient> {
  let connectionFailure: Error | undefined;
  const captureConnectionFailure = (error: Error): void => {
    connectionFailure ??= error;
  };
  const transport =
    options.server.transport === "http"
      ? new StreamableHTTPClientTransport(new URL(options.server.url), {
          requestInit: { headers: options.server.headers },
        })
      : new AgentMcpStdioTransport({
          command: options.server.command,
          args: options.server.args,
          cwd: options.server.cwd,
          env: options.server.env,
          signal: options.signal,
          profile: options.executionProfile,
          spawnPersistentProcess: options.spawnPersistentProcess,
          terminationGraceMs: options.terminationGraceMs,
          maxFrameBytes: options.maxFrameBytes,
          maxStderrBytes: options.maxStderrBytes,
        });
  transport.onerror = captureConnectionFailure;
  const clientTaskStore = options.interactionInput ? new InMemoryTaskStore() : undefined;
  const client = new Client(
    { name: "senera-mcp-tool-client", version: "0.1.0" },
    {
      capabilities: {
        ...(options.sampling ? { sampling: {} } : {}),
        ...(options.interactionInput ? { elicitation: { form: {}, url: {} } } : {}),
        ...(clientTaskStore ? { tasks: { requests: { elicitation: { create: {} } } } } : {}),
        experimental: {
          [AgentMcpProtocol.taskEvents.capability]: { version: AgentMcpProtocol.taskEvents.version },
        },
      },
      taskStore: clientTaskStore,
      enforceStrictCapabilities: true,
      listChanged: createAgentMcpToolListChangedHandlers({
        server: options.server,
        onToolsChanged: options.onToolsChanged,
        onError: (error) => reportAgentMcpBackgroundError(client, error),
      }),
    },
  );
  const toolClient = new AgentMcpToolClient(client, options, clientTaskStore, () => connectionFailure);
  try {
    await client.connect(transport, agentMcpRequestOptions(options));
  } catch (error) {
    throw preferAgentMcpConnectionFailure(error, connectionFailure);
  }
  return toolClient;
}

export class AgentMcpToolClient {
  private _closed = false;
  private clientTaskStoreDisposed = false;
  private readonly notifications: AgentMcpCallNotificationController;
  private readonly elicitation: AgentMcpElicitationController;
  private readonly tasks: AgentMcpTaskController;

  constructor(
    private readonly client: Client,
    private readonly options: AgentMcpToolClientOptions,
    private readonly clientTaskStore?: Pick<InMemoryTaskStore, "cleanup">,
    private readonly connectionFailure?: () => Error | undefined,
  ) {
    client.onclose = () => {
      this._closed = true;
      this.disposeClientTaskStore();
    };
    this.notifications = new AgentMcpCallNotificationController(client, options);
    this.elicitation = new AgentMcpElicitationController(client, options.interactionInput);
    this.tasks = new AgentMcpTaskController(client, options, this.notifications, () => this._closed);
    if (options.sampling) {
      client.setRequestHandler(CreateMessageRequestSchema, (request, extra) =>
        options.sampling!(request.params, extra.signal),
      );
    }
  }

  get closed(): boolean {
    return this._closed;
  }

  async listTools(): Promise<readonly AgentMcpToolDeclaration[]> {
    try {
      return (await this.client.listTools(undefined, agentMcpRequestOptions(this.options))).tools;
    } catch (error) {
      throw this.withConnectionFailure(error);
    }
  }

  async callTool(name: string, args: Record<string, unknown>, options: AgentMcpToolCallOptions = {}): Promise<unknown> {
    try {
      return await this.elicitation.run(options, () => this.callToolWithinScope(name, args, options));
    } catch (error) {
      throw this.withConnectionFailure(error);
    }
  }

  async reattachTask(taskId: string, options: AgentMcpToolCallOptions = {}): Promise<unknown> {
    try {
      return await this.elicitation.run(options, () => this.tasks.reattach(taskId, options));
    } catch (error) {
      throw this.withConnectionFailure(error);
    }
  }

  async close(): Promise<void> {
    if (!this._closed) {
      this._closed = true;
      try {
        await this.client.close();
      } finally {
        this.disposeClientTaskStore();
      }
      return;
    }
    this.disposeClientTaskStore();
  }

  private async callToolWithinScope(
    name: string,
    args: Record<string, unknown>,
    options: AgentMcpToolCallOptions,
  ): Promise<unknown> {
    const notifications = this.notifications.open(options);
    const correlation = options.correlation;
    const params = {
      name,
      arguments: args,
      ...(correlation || notifications.outputToken || notifications.progressToken
        ? {
            _meta: {
              ...(notifications.progressToken ? { progressToken: notifications.progressToken } : {}),
              senera: { ...correlation, outputToken: notifications.outputToken },
            },
          }
        : {}),
    };
    try {
      const call = () =>
        options.task
          ? this.tasks.call(params, options)
          : this.client.callTool(params, undefined, agentMcpRequestOptions(this.options, options));
      try {
        return await call();
      } catch (error) {
        if (!(error instanceof UrlElicitationRequiredError)) throw error;
        await this.elicitation.resolveRequiredUrls(error.elicitations, options);
        return await call();
      }
    } finally {
      notifications.close();
    }
  }

  private withConnectionFailure(error: unknown): unknown {
    return preferAgentMcpConnectionFailure(error, this.connectionFailure?.());
  }

  private disposeClientTaskStore(): void {
    if (this.clientTaskStoreDisposed) return;
    this.clientTaskStoreDisposed = true;
    this.clientTaskStore?.cleanup();
  }
}
