export const AgentPiSessionExportFormats = {
  Jsonl: "jsonl",
  Html: "html",
} as const;

export type AgentPiSessionExportFormat = (typeof AgentPiSessionExportFormats)[keyof typeof AgentPiSessionExportFormats];

export interface AgentPiSessionCompactionResult {
  readonly summary: string;
  readonly tokensBefore: number;
  readonly estimatedTokensAfter?: number;
}

export interface AgentPiSessionRuntimeStatus {
  readonly sessionId: string;
  readonly cached: boolean;
  readonly stats: AgentPiSessionStats;
  readonly contextUsage?: AgentPiSessionContextUsage;
}

export interface AgentPiSessionStats {
  readonly userMessages: number;
  readonly assistantMessages: number;
  readonly toolCalls: number;
  readonly toolResults: number;
  readonly totalMessages: number;
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    readonly total: number;
  };
  readonly cost: number;
}

export interface AgentPiSessionContextUsage {
  readonly tokens: number | null;
  readonly contextWindow: number;
  readonly percent: number | null;
}

export interface AgentPiSessionExportResult {
  readonly sessionId: string;
  readonly format: AgentPiSessionExportFormat;
  readonly path: string;
}
