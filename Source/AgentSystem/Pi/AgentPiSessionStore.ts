import {
  JsonlSessionRepo,
  type ExecutionEnv,
  type JsonlSessionMetadata,
  type Session,
} from "@earendil-works/pi-agent-core";
import { createRequestId } from "../Core/AgentIds.js";

export interface AgentPiSessionStoreOptions {
  workspaceRoot: string;
  sessionsRoot: string;
  env: Pick<
    ExecutionEnv,
    | "cwd"
    | "absolutePath"
    | "joinPath"
    | "readTextFile"
    | "readTextLines"
    | "writeFile"
    | "appendFile"
    | "listDir"
    | "exists"
    | "createDir"
    | "remove"
  >;
}

export interface AgentPiOpenSessionRequest {
  sessionId?: string;
  fallbackId?: string;
}

export interface AgentPiOpenSessionResult {
  sessionId: string;
  session: Session;
  storage: "created" | "existing";
}

export interface AgentPiSessionStorePort {
  openOrCreate(request: AgentPiOpenSessionRequest): Promise<AgentPiOpenSessionResult>;
}

const PiSessionOpenQueues = new Map<string, Promise<AgentPiOpenSessionResult>>();

export class AgentPiSessionStore implements AgentPiSessionStorePort {
  private readonly repo: JsonlSessionRepo;
  private readonly metadataBySessionId = new Map<string, JsonlSessionMetadata>();

  constructor(private readonly options: AgentPiSessionStoreOptions) {
    this.repo = new JsonlSessionRepo({
      fs: options.env,
      sessionsRoot: options.sessionsRoot,
    });
  }

  async openOrCreate(request: AgentPiOpenSessionRequest): Promise<AgentPiOpenSessionResult> {
    const sessionId = resolvePiSessionId(request);
    const queueKey = this.openQueueKey(sessionId);
    const current = PiSessionOpenQueues.get(queueKey);
    if (current) {
      await current.catch(() => undefined);
      return this.openOrCreateUnlocked(sessionId);
    }

    const opening = this.openOrCreateUnlocked(sessionId);
    PiSessionOpenQueues.set(queueKey, opening);
    try {
      return await opening;
    } finally {
      if (PiSessionOpenQueues.get(queueKey) === opening) {
        PiSessionOpenQueues.delete(queueKey);
      }
    }
  }

  private async openOrCreateUnlocked(sessionId: string): Promise<AgentPiOpenSessionResult> {
    const metadata = await this.findMetadata(sessionId);
    if (metadata) {
      return {
        sessionId,
        session: await this.openKnownSession(sessionId, metadata),
        storage: "existing",
      };
    }

    const session = await this.repo.create({
      id: sessionId,
      cwd: this.options.workspaceRoot,
    });
    this.metadataBySessionId.set(sessionId, await session.getMetadata());
    return {
      sessionId,
      session,
      storage: "created",
    };
  }

  private openQueueKey(sessionId: string): string {
    return JSON.stringify([this.options.workspaceRoot, this.options.sessionsRoot, sessionId]);
  }

  private async openKnownSession(sessionId: string, metadata: JsonlSessionMetadata): Promise<Session> {
    try {
      return await this.repo.open(metadata);
    } catch (error) {
      if (!isMissingSessionError(error)) {
        throw error;
      }
      this.metadataBySessionId.delete(sessionId);
      const session = await this.repo.create({
        id: sessionId,
        cwd: this.options.workspaceRoot,
      });
      this.metadataBySessionId.set(sessionId, await session.getMetadata());
      return session;
    }
  }

  private async findMetadata(sessionId: string): Promise<JsonlSessionMetadata | undefined> {
    const cached = this.metadataBySessionId.get(sessionId);
    if (cached) {
      return cached;
    }

    const metadata = (await this.repo.list({ cwd: this.options.workspaceRoot })).find(
      (entry) => entry.id === sessionId,
    );
    if (metadata) {
      this.metadataBySessionId.set(sessionId, metadata);
    }
    return metadata;
  }
}

function resolvePiSessionId(request: AgentPiOpenSessionRequest): string {
  return request.sessionId?.trim() || request.fallbackId?.trim() || createRequestId();
}

function isMissingSessionError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "not_found");
}
