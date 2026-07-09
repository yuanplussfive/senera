import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { SeneraProcessExecutionProfile } from "../Execution/SeneraExecutionProfile.js";
import type { SeneraPersistentProcessSpawner } from "../Execution/SeneraPersistentProcessTypes.js";
import { AgentMcpStdioTransport } from "./AgentMcpStdioTransport.js";
import type { ResolvedMcpServerManifest } from "./AgentMcpManifestResolver.js";

export interface AgentMcpToolClientOptions {
  server: ResolvedMcpServerManifest;
  requestTimeoutMs: number;
  spawnPersistentProcess: SeneraPersistentProcessSpawner;
  executionProfile: SeneraProcessExecutionProfile;
  signal?: AbortSignal;
}

export async function withAgentMcpToolClient<TValue>(
  options: AgentMcpToolClientOptions,
  operation: (client: AgentMcpToolClient) => Promise<TValue>,
): Promise<TValue> {
  const transport = new AgentMcpStdioTransport({
    command: options.server.command,
    args: options.server.args,
    cwd: options.server.cwd,
    env: options.server.env,
    signal: options.signal,
    profile: options.executionProfile,
    spawnPersistentProcess: options.spawnPersistentProcess,
  });
  const client = new Client({
    name: "senera-mcp-tool-client",
    version: "0.1.0",
  }, {
    capabilities: {},
  });

  await client.connect(transport, mcpRequestOptions(options));
  try {
    return await operation(new AgentMcpToolClient(client, options));
  } finally {
    await client.close();
  }
}

export class AgentMcpToolClient {
  constructor(
    private readonly client: Client,
    private readonly options: AgentMcpToolClientOptions,
  ) {}

  callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.client.callTool(
      { name, arguments: args },
      undefined,
      mcpRequestOptions(this.options),
    );
  }
}

function mcpRequestOptions(options: AgentMcpToolClientOptions): RequestOptions {
  return {
    signal: options.signal,
    timeout: options.requestTimeoutMs,
  };
}
