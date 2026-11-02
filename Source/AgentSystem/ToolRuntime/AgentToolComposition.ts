/** A programmatic consumer of the same authorized tools used by the agent. */
export interface AgentToolCompositionDeclaration {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
  readonly namespace?: {
    readonly name: string;
    readonly title?: string;
    readonly description?: string;
  };
}

export interface AgentToolCompositionStoreWrites {
  readonly set: Record<string, unknown>;
  readonly delete: readonly string[];
}

export interface AgentToolCompositionState {
  read(): Readonly<Record<string, unknown>>;
  commit(writes: AgentToolCompositionStoreWrites): void;
}

export interface AgentToolComposition {
  readonly tools: readonly AgentToolCompositionDeclaration[];
  readonly state: AgentToolCompositionState;
  readonly signal: AbortSignal;
  execute(name: string, args: unknown, signal: AbortSignal): Promise<unknown>;
  /** Search only the frozen callable names using the host's shared retrieval service. */
  search?: (
    query: string,
    toolNames: readonly string[],
    signal: AbortSignal,
  ) => Promise<{
    readonly names: readonly string[];
    readonly status?: string;
    readonly reason?: string;
    readonly diagnostics?: readonly string[];
  }>;
  settle(): Promise<void>;
}
