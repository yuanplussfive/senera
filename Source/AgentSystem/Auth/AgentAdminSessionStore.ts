import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  AgentAuthenticationMethods,
  type AgentAuthenticationMethod,
  type AgentAdminSession,
  type AgentServerPrincipal,
} from "./AgentAuthenticationProtocol.js";

export type { AgentAdminSession, AgentServerPrincipal } from "./AgentAuthenticationProtocol.js";

interface StoredSession extends AgentAdminSession {
  readonly digest: string;
}

export class AgentAdminSessionStore {
  private readonly signingKey = randomBytes(32);
  private readonly sessions = new Map<string, StoredSession>();

  constructor(
    private readonly options: {
      absoluteTtlMs: number;
      idleTtlMs: number;
      maxSessions: number;
      now?: () => number;
    },
  ) {}

  issue(
    account: Pick<AgentServerPrincipal, "id" | "loginName" | "displayName">,
    deviceName?: string,
    authenticationMethod: AgentAuthenticationMethod = AgentAuthenticationMethods.Account,
  ): { token: string; session: AgentAdminSession } {
    const now = this.now();
    this.prune(now);
    this.evictForNewSession();

    const token = randomToken();
    const session: StoredSession = {
      id: randomToken(),
      digest: this.digest(token),
      authenticationMethod,
      principal: {
        id: account.id,
        loginName: account.loginName,
        displayName: account.displayName,
        role: "owner",
      },
      csrfToken: randomToken(),
      expiresAt: now + this.options.absoluteTtlMs,
      idleExpiresAt: now + this.options.idleTtlMs,
      createdAt: now,
      lastSeenAt: now,
      ...(deviceName ? { deviceName } : {}),
    };
    this.sessions.set(session.digest, session);
    return { token, session: publicSession(session) };
  }

  read(token: string | undefined, touch = false): AgentAdminSession | undefined {
    if (!token) {
      return undefined;
    }
    const digest = this.digest(token);
    const session = this.sessions.get(digest);
    if (!session || this.isExpired(session, this.now())) {
      this.sessions.delete(digest);
      return undefined;
    }

    if (touch) {
      const now = this.now();
      const next: StoredSession = {
        ...session,
        lastSeenAt: now,
        idleExpiresAt: Math.min(session.expiresAt, now + this.options.idleTtlMs),
      };
      this.sessions.set(digest, next);
      return publicSession(next);
    }
    return publicSession(session);
  }

  verifyCsrf(session: AgentAdminSession, candidate: string | undefined): boolean {
    if (!candidate) {
      return false;
    }
    const expected = Buffer.from(session.csrfToken);
    const actual = Buffer.from(candidate);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  revoke(token: string | undefined): void {
    if (token) {
      this.sessions.delete(this.digest(token));
    }
  }

  revokeAll(): void {
    this.sessions.clear();
  }

  listDevices(principalId: string): AgentAdminSession[] {
    this.prune(this.now());
    return [...this.sessions.values()]
      .filter((session) => session.principal.id === principalId && session.deviceName !== undefined)
      .map(publicSession);
  }

  hasSession(id: string): boolean {
    return this.findById(id) !== undefined;
  }

  findById(id: string): AgentAdminSession | undefined {
    this.prune(this.now());
    const session = [...this.sessions.values()].find((session) => session.id === id);
    return session ? publicSession(session) : undefined;
  }

  revokeDevice(id: string, principalId: string): boolean {
    for (const [digest, session] of this.sessions) {
      if (session.id === id && session.principal.id === principalId && session.deviceName !== undefined) {
        this.sessions.delete(digest);
        return true;
      }
    }
    return false;
  }

  private evictForNewSession(): void {
    while (this.sessions.size >= this.options.maxSessions) {
      const oldest = [...this.sessions.values()].sort((left, right) => left.lastSeenAt - right.lastSeenAt)[0];
      if (!oldest) {
        return;
      }
      this.sessions.delete(oldest.digest);
    }
  }

  private prune(now: number): void {
    for (const [digest, session] of this.sessions) {
      if (this.isExpired(session, now)) {
        this.sessions.delete(digest);
      }
    }
  }

  private isExpired(session: StoredSession, now: number): boolean {
    return now >= session.expiresAt || now >= session.idleExpiresAt;
  }

  private digest(token: string): string {
    return createHmac("sha256", this.signingKey).update(token).digest("base64url");
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function publicSession(session: StoredSession): AgentAdminSession {
  const { digest: _digest, ...publicValue } = session;
  return publicValue;
}
