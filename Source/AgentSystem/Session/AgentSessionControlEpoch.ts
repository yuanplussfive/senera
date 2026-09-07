export interface AgentSessionControlToken {
  readonly sessionId: string;
  readonly revision: symbol;
}

export class AgentSessionControlEpoch {
  private readonly currentTokens = new Map<string, AgentSessionControlToken>();

  issue(sessionId: string): AgentSessionControlToken {
    const token = { sessionId, revision: Symbol(sessionId) };
    this.currentTokens.set(sessionId, token);
    return token;
  }

  isCurrent(token: AgentSessionControlToken): boolean {
    return this.currentTokens.get(token.sessionId) === token;
  }

  invalidate(sessionId: string): void {
    this.currentTokens.delete(sessionId);
  }

  retire(token: AgentSessionControlToken): void {
    if (this.isCurrent(token)) this.currentTokens.delete(token.sessionId);
  }
}
