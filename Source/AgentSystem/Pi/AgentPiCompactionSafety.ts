/**
 * A prepared compaction candidate is derived work, not an instruction to
 * mutate the live Pi session immediately. It may be materialized only at a
 * boundary where Pi cannot interleave another compaction or a queued turn.
 */
export interface AgentPiCompactionApplyState {
  readonly isIdle: boolean;
  readonly isCompacting: boolean;
  readonly pendingMessageCount: number;
}

export function canApplyAgentPiCompactionCandidate(state: AgentPiCompactionApplyState): boolean {
  return state.isIdle && !state.isCompacting && state.pendingMessageCount === 0;
}
