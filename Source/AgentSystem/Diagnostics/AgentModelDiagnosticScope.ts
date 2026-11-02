import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentPiDiagnosticContext, AgentPiDiagnosticSink } from "../PiShared/AgentPiDiagnosticsTypes.js";

interface AgentModelDiagnosticScope {
  readonly sink?: AgentPiDiagnosticSink;
  readonly context: AgentPiDiagnosticContext;
}

const scopes = new AsyncLocalStorage<AgentModelDiagnosticScope>();

export function activeAgentModelDiagnosticScope(): AgentModelDiagnosticScope | undefined {
  return scopes.getStore();
}

/** Async-local ownership keeps concurrent sessions and detached learning jobs separate. */
export function withAgentModelDiagnosticScope<T>(scope: AgentModelDiagnosticScope, run: () => T): T {
  const parent = scopes.getStore();
  return scopes.run({ sink: scope.sink ?? parent?.sink, context: { ...parent?.context, ...scope.context } }, run);
}
