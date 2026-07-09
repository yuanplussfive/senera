import type { AgentPiSession } from "./AgentPiSubstrate.js";

export interface AgentPiActiveSessionHandle {
  sessionId: string;
  requestId: string;
  step: number;
  session: AgentPiSession;
}

export class AgentPiActiveSessionRegistry {
  private readonly handles = new Map<string, AgentPiActiveSessionHandle>();

  register(handle: AgentPiActiveSessionHandle): () => void {
    this.handles.set(handle.sessionId, handle);

    return () => {
      if (this.handles.get(handle.sessionId) === handle) {
        this.handles.delete(handle.sessionId);
      }
    };
  }

  get(sessionId: string): AgentPiActiveSessionHandle | undefined {
    return this.handles.get(sessionId);
  }

  delete(sessionId: string): void {
    this.handles.delete(sessionId);
  }
}
