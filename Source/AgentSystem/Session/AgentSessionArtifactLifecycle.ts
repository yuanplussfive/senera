export interface AgentSessionArtifactForkRequest {
  readonly sourceSessionId: string;
  readonly targetSessionId: string;
  readonly requestIds: readonly string[];
}

export interface AgentSessionArtifactLifecycle {
  retainForkArtifacts(request: AgentSessionArtifactForkRequest): Promise<unknown>;
  removeSessionArtifacts(sessionId: string): Promise<unknown>;
  removeSessionArtifactsFromRequests(sessionId: string, requestIds: readonly string[]): Promise<unknown>;
}
