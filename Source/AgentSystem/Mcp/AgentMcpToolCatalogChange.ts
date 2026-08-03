import type { AgentMcpRuntimeEndpoint } from "../McpPackages/AgentMcpPackageTypes.js";
import type { ListChangedHandlers } from "@modelcontextprotocol/sdk/types.js";

export interface AgentMcpToolDeclaration {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema?: Readonly<Record<string, unknown>>;
  readonly annotations?: {
    readonly title?: string;
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
    readonly idempotentHint?: boolean;
    readonly openWorldHint?: boolean;
  };
}

export interface AgentMcpToolsChanged {
  readonly server: AgentMcpRuntimeEndpoint;
  readonly declarations: readonly AgentMcpToolDeclaration[];
}

export type AgentMcpToolsChangedHandler = (change: AgentMcpToolsChanged) => void | Promise<void>;

export function createAgentMcpToolListChangedHandlers(options: {
  readonly server: AgentMcpRuntimeEndpoint;
  readonly onToolsChanged?: AgentMcpToolsChangedHandler;
  readonly onError: (error: unknown) => void;
}): ListChangedHandlers | undefined {
  const onToolsChanged = options.onToolsChanged;
  if (!onToolsChanged) return undefined;
  return {
    tools: {
      onChanged: (error, declarations) => {
        if (error) {
          options.onError(error);
          return;
        }
        if (!declarations) return;
        void Promise.resolve(onToolsChanged({ server: options.server, declarations })).catch(options.onError);
      },
    },
  };
}
