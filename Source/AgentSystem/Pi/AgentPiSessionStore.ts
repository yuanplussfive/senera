import {
  JsonlSessionRepo,
  type ExecutionEnv,
  type JsonlSessionMetadata,
  type Session,
} from "@earendil-works/pi-agent-core";
import { createRequestId } from "../Core/AgentIds.js";
import { AgentKeyedLeaseQueue } from "../Core/AgentKeyedLeaseQueue.js";
import { resolveAgentPiSessionCacheCapacity } from "./AgentPiSessionCachePolicy.js";

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
  maxCachedSessions?: number;
}

export interface AgentPiOpenSessionRequest {
  sessionId?: string;
  fallbackId?: string;
  signal?: AbortSignal;
}

export interface AgentPiOpenSessionResult {
  sessionId: string;
  session: Session;
  storage: "created" | "existing";
}

export interface AgentPiSessionStorePort {
  openOrCreate(request: AgentPiOpenSessionRequest): Promise<AgentPiOpenSessionResult>;
  rewind(sessionId: string, entryId: string): Promise<boolean>;
  reset(sessionId: string): Promise<boolean>;
}

const PiSessionOperations = new AgentKeyedLeaseQueue<string>();

export class AgentPiSessionStore implements AgentPiSessionStorePort {
  private readonly repo: JsonlSessionRepo;
  private readonly metadataBySessionId = new Map<string, JsonlSessionMetadata>();
  private readonly sessionsBySessionId = new Map<string, Session>();
  private readonly maxCachedSessions: number;
  private metadataIndexPromise?: Promise<void>;

  constructor(private readonly options: AgentPiSessionStoreOptions) {
    this.repo = new JsonlSessionRepo({
      fs: options.env,
      sessionsRoot: options.sessionsRoot,
    });
    this.maxCachedSessions = resolveAgentPiSessionCacheCapacity(options.maxCachedSessions);
  }

  async openOrCreate(request: AgentPiOpenSessionRequest): Promise<AgentPiOpenSessionResult> {
    const sessionId = resolvePiSessionId(request);
    return this.withSessionLock(sessionId, () => this.openOrCreateUnlocked(sessionId), request.signal);
  }

  async reset(sessionId: string): Promise<boolean> {
    return this.withSessionLock(sessionId, () => this.resetUnlocked(sessionId));
  }

  async rewind(sessionId: string, entryId: string): Promise<boolean> {
    return this.withSessionLock(sessionId, async () => {
      const metadata = await this.findMetadata(sessionId);
      if (!metadata) return false;
      const session = await this.openKnownSession(sessionId, metadata);
      if (!(await session.getEntry(entryId))) return false;
      await session.moveTo(entryId);
      return true;
    });
  }

  private async resetUnlocked(sessionId: string): Promise<boolean> {
    const metadata = await this.findMetadata(sessionId);
    this.metadataBySessionId.delete(sessionId);
    this.sessionsBySessionId.delete(sessionId);
    if (!metadata) return false;
    await this.repo.delete(metadata);
    return true;
  }

  private async openOrCreateUnlocked(sessionId: string): Promise<AgentPiOpenSessionResult> {
    const cached = this.readCachedSession(sessionId);
    if (cached) {
      return {
        sessionId,
        session: cached,
        storage: "existing",
      };
    }

    const metadata = await this.findMetadata(sessionId);
    if (metadata) {
      return {
        sessionId,
        session: await this.openKnownSession(sessionId, metadata),
        storage: "existing",
      };
    }

    return this.createUnlocked(sessionId);
  }

  private async createUnlocked(sessionId: string): Promise<AgentPiOpenSessionResult> {
    const cached = this.readCachedSession(sessionId);
    if (cached) {
      return {
        sessionId,
        session: cached,
        storage: "existing",
      };
    }

    const session = await this.repo.create({
      id: sessionId,
      cwd: this.options.workspaceRoot,
    });
    this.cacheSession(sessionId, session);
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

  private withSessionLock<T>(sessionId: string, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return PiSessionOperations.run(this.openQueueKey(sessionId), operation, signal);
  }

  private async openKnownSession(sessionId: string, metadata: JsonlSessionMetadata): Promise<Session> {
    const cached = this.readCachedSession(sessionId);
    if (cached) return cached;

    try {
      const session = await this.repo.open(metadata);
      this.cacheSession(sessionId, session);
      return session;
    } catch (error) {
      if (!isMissingSessionError(error)) {
        throw error;
      }
      this.metadataBySessionId.delete(sessionId);
      const session = await this.repo.create({
        id: sessionId,
        cwd: this.options.workspaceRoot,
      });
      this.cacheSession(sessionId, session);
      this.metadataBySessionId.set(sessionId, await session.getMetadata());
      return session;
    }
  }

  private async findMetadata(sessionId: string): Promise<JsonlSessionMetadata | undefined> {
    const cached = this.metadataBySessionId.get(sessionId);
    if (cached) {
      return cached;
    }

    await this.ensureMetadataIndex();
    return this.metadataBySessionId.get(sessionId);
  }

  private async ensureMetadataIndex(): Promise<void> {
    if (!this.metadataIndexPromise) {
      this.metadataIndexPromise = this.loadMetadataIndex().catch((error) => {
        this.metadataIndexPromise = undefined;
        throw error;
      });
    }
    await this.metadataIndexPromise;
  }

  private async loadMetadataIndex(): Promise<void> {
    const metadata = await this.repo.list({ cwd: this.options.workspaceRoot });
    for (const entry of metadata) {
      if (!this.metadataBySessionId.has(entry.id)) this.metadataBySessionId.set(entry.id, entry);
    }
  }

  private readCachedSession(sessionId: string): Session | undefined {
    const session = this.sessionsBySessionId.get(sessionId);
    if (!session) return undefined;
    this.sessionsBySessionId.delete(sessionId);
    this.sessionsBySessionId.set(sessionId, session);
    return session;
  }

  private cacheSession(sessionId: string, session: Session): void {
    if (this.maxCachedSessions === 0) return;
    this.sessionsBySessionId.delete(sessionId);
    this.sessionsBySessionId.set(sessionId, session);
    while (this.sessionsBySessionId.size > this.maxCachedSessions) {
      const oldestSessionId = this.sessionsBySessionId.keys().next().value;
      if (typeof oldestSessionId !== "string") break;
      this.sessionsBySessionId.delete(oldestSessionId);
    }
  }
}

function resolvePiSessionId(request: AgentPiOpenSessionRequest): string {
  return request.sessionId?.trim() || request.fallbackId?.trim() || createRequestId();
}

function isMissingSessionError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "not_found");
}
