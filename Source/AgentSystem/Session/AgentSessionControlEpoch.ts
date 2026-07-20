export interface AgentSessionControlToken {
  readonly sessionId: string;
  readonly revision: number;
}

export class AgentSessionControlEpoch {
  private readonly revisions = new Map<string, number>();

  issue(sessionId: string): AgentSessionControlToken {
    const revision = (this.revisions.get(sessionId) ?? 0) + 1;
    this.revisions.set(sessionId, revision);
    return { sessionId, revision };
  }

  isCurrent(token: AgentSessionControlToken): boolean {
    return this.revisions.get(token.sessionId) === token.revision;
  }
}
