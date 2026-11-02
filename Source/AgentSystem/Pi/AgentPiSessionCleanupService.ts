import { removeAgentPathWithRetry } from "../Core/AgentFs.js";
import { findAgentPiSessionFile } from "./AgentPiSessionStorage.js";

export interface AgentPiSessionCleanupRequest {
  readonly sessionId: string;
}

export interface AgentPiSessionCleanupPort {
  removeSession(request: AgentPiSessionCleanupRequest): Promise<boolean>;
}

export interface AgentPiSessionCleanupServiceOptions {
  readonly workspaceRoot: string;
  readonly sessionsRoot: string;
}

/**
 * Removes a persisted Pi transcript without constructing a model runtime.
 * Historical sessions may reference providers that no longer exist in the
 * current configuration, but their storage must remain independently
 * deletable.
 */
export class AgentPiSessionCleanupService implements AgentPiSessionCleanupPort {
  constructor(private readonly options: AgentPiSessionCleanupServiceOptions) {}

  async removeSession({ sessionId }: AgentPiSessionCleanupRequest): Promise<boolean> {
    const session = await findAgentPiSessionFile(this.options.workspaceRoot, this.options.sessionsRoot, sessionId);
    if (!session) return false;
    await removeAgentPathWithRetry(session.path, { deferOnBusy: true });
    return true;
  }
}
