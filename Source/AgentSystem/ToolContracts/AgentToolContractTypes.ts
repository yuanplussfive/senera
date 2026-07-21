export const AgentToolContractVersion = 1 as const;

interface AgentToolContractSourceBase {
  readonly identity: string;
  readonly sha256: string;
}

export interface AgentTypescriptToolContractSource extends AgentToolContractSourceBase {
  readonly kind: "typescript";
  readonly file: string;
  readonly type?: string;
}

export interface AgentSchemaToolContractSource extends AgentToolContractSourceBase {
  readonly kind: "schema";
  readonly file?: string;
}

export type AgentToolContractSource = AgentTypescriptToolContractSource | AgentSchemaToolContractSource;

export interface AgentToolContractDefinition {
  readonly source: AgentToolContractSource;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema?: Readonly<Record<string, unknown>>;
}

export interface AgentToolContractBundle {
  readonly contractVersion: typeof AgentToolContractVersion;
  readonly tools: Readonly<Record<string, AgentToolContractDefinition>>;
}
