import crypto from "node:crypto";
import type { SeneraProcessExecutionProfile } from "../Execution/SeneraExecutionProfile.js";
import {
  AgentMcpTaskDetachedError,
  AgentMcpToolClient,
  type AgentMcpToolCallOptions,
  type AgentMcpToolClientOptions,
  openAgentMcpToolClient,
} from "./AgentMcpToolClient.js";

interface AgentMcpToolClientPoolEntry {
  readonly key: string;
  readonly controller: AbortController;
  readonly opening: Promise<AgentMcpToolClient>;
}

const MaxStaleClientReplacements = 1;

export class AgentMcpToolClientUnavailableError extends Error {
  constructor(
    readonly serverId: string,
    readonly replacements: number,
  ) {
    super(`MCP server ${serverId} closed during connection acquisition after ${replacements} replacement attempt(s).`);
    this.name = "AgentMcpToolClientUnavailableError";
  }
}

export class AgentMcpToolClientPool {
  private readonly entries = new Map<string, AgentMcpToolClientPoolEntry>();
  private closed = false;
  private closePromise: Promise<void> | undefined;

  constructor(
    private readonly openClient: (
      options: AgentMcpToolClientOptions,
    ) => Promise<AgentMcpToolClient> = openAgentMcpToolClient,
  ) {}

  async withClient<TValue>(
    options: Omit<AgentMcpToolClientOptions, "signal">,
    operation: (client: AgentMcpToolClient) => Promise<TValue>,
  ): Promise<TValue> {
    for (let replacements = 0; ; replacements += 1) {
      const entry = this.acquire(options);
      const client = await entry.opening;
      if (client.closed) {
        this.evict(entry);
        if (replacements >= MaxStaleClientReplacements) {
          throw new AgentMcpToolClientUnavailableError(options.server.id, replacements);
        }
        continue;
      }

      try {
        return await operation(client);
      } catch (error) {
        if (client.closed) this.evict(entry);
        throw error;
      }
    }
  }

  async withRecoverableTask<TValue>(
    options: Omit<AgentMcpToolClientOptions, "signal">,
    operation: (client: AgentMcpToolClient) => Promise<TValue>,
    taskOptions: AgentMcpToolCallOptions,
    onDetached?: (error: AgentMcpTaskDetachedError) => void,
  ): Promise<TValue> {
    try {
      return await this.withClient(options, operation);
    } catch (error) {
      if (!(error instanceof AgentMcpTaskDetachedError)) throw error;
      onDetached?.(error);
      return this.withClient(options, (client) => client.reattachTask(error.taskId, taskOptions) as Promise<TValue>);
    }
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    const closing = this.closeClients().finally(() => {
      if (this.closePromise === closing) this.closePromise = undefined;
    });
    this.closePromise = closing;
    return closing;
  }

  private async closeClients(): Promise<void> {
    this.closed = true;
    const entries = [...this.entries.values()];
    for (const entry of entries) entry.controller.abort();
    const failures: unknown[] = [];
    await Promise.all(
      entries.map(async (entry) => {
        try {
          const client = await entry.opening;
          await client.close();
          if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
        } catch (error) {
          failures.push(error);
        }
      }),
    );
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "MCP client pool cleanup failed.");
  }

  private acquire(options: Omit<AgentMcpToolClientOptions, "signal">): AgentMcpToolClientPoolEntry {
    if (this.closed) throw new Error("MCP tool client pool is closed.");
    const key = createAgentMcpToolClientPoolKey(options);
    const current = this.entries.get(key);
    if (current) return current;

    const controller = new AbortController();
    const entry: AgentMcpToolClientPoolEntry = {
      key,
      controller,
      opening: this.openClient({ ...options, signal: controller.signal }),
    };
    this.entries.set(key, entry);
    void entry.opening.catch(() => this.evict(entry));
    return entry;
  }

  private evict(entry: AgentMcpToolClientPoolEntry): void {
    if (this.entries.get(entry.key) !== entry) return;
    this.entries.delete(entry.key);
    entry.controller.abort();
    void entry.opening.then((client) => client.close()).catch(() => undefined);
  }
}

export function createAgentMcpToolClientPoolKey(
  options: Pick<AgentMcpToolClientOptions, "server" | "executionProfile" | "terminationGraceMs" | "interactionInput">,
): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        server: options.server,
        executionProfile: projectExecutionProfileIdentity(options.executionProfile),
        terminationGraceMs: options.terminationGraceMs,
        elicitation: Boolean(options.interactionInput),
      }),
    )
    .digest("hex");
}

function projectExecutionProfileIdentity(profile: SeneraProcessExecutionProfile): unknown {
  return {
    name: profile.name,
    kind: profile.kind,
    backend: profile.backend,
    microsandbox: profile.microsandbox,
  };
}
