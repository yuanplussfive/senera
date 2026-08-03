/**
 * Diagnostic type definitions and source identifiers for the Pi agent.
 *
 * Extracted from Pi/AgentPiDiagnostics.ts to break the Pi ↔ PiProxy
 * circular dependency. The diagnostic emission functions (emitAgentPiDiagnostic,
 * createAgentPiDiagnosticEvent, etc.) remain in Pi/AgentPiDiagnostics.ts and
 * import these types from here.
 */

export const AgentPiDiagnosticSources = {
  Session: "session",
  Proxy: "proxy",
  Substrate: "substrate",
} as const;

export type AgentPiDiagnosticSource = (typeof AgentPiDiagnosticSources)[keyof typeof AgentPiDiagnosticSources];

export interface AgentPiDiagnosticContext {
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly step?: number;
}

export interface AgentPiDiagnosticInput {
  readonly context?: AgentPiDiagnosticContext;
  readonly source: AgentPiDiagnosticSource;
  readonly name: string;
  readonly summary?: string;
  readonly details?: unknown;
}

export interface AgentPiDiagnosticEvent {
  readonly context: AgentPiDiagnosticContext;
  readonly source: AgentPiDiagnosticSource;
  readonly name: string;
  readonly summary: string;
  readonly details?: unknown;
}

export type AgentPiDiagnosticSink = (event: AgentPiDiagnosticEvent) => void | Promise<void>;
