import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";

/**
 * A short-lived, session-scoped record of contracts that the model has
 * actually seen and successful arguments it can safely reuse.  This is kept
 * separate from tool exposure: a tool may be visible without its contract
 * being confirmed, and a confirmed contract may remain reusable after a
 * later search.
 */
export interface AgentToolCapabilityCacheEntry {
  readonly toolName: string;
  readonly catalogRevision: string;
  readonly contractDigest?: string;
  /** The user-turn intent that produced the successful invocation. */
  readonly query?: string;
  readonly arguments?: Readonly<Record<string, unknown>>;
  readonly confirmedAt: number;
  readonly lastUsedAt: number;
}

export interface AgentToolCapabilityCacheState {
  readonly contract: "unconfirmed" | "confirmed";
  readonly reuse: "none" | "arguments";
  readonly reusableArguments?: Readonly<Record<string, unknown>>;
}

interface MutableEntry {
  toolName: string;
  catalogRevision: string;
  contractDigest?: string;
  query?: string;
  arguments?: Readonly<Record<string, unknown>>;
  confirmedAt: number;
  lastUsedAt: number;
}

const DefaultPolicy = Object.freeze({
  maxSessions: 128,
  maxEntriesPerSession: 64,
});

export class AgentToolCapabilitySessionCache {
  private readonly sessions = new Map<string, Map<string, MutableEntry>>();

  constructor(
    private readonly policy: {
      readonly maxSessions?: number;
      readonly maxEntriesPerSession?: number;
    } = DefaultPolicy,
  ) {}

  rememberContract(input: {
    sessionId?: string;
    toolName: string;
    catalogRevision: string;
    contractDigest?: string;
    now?: number;
  }): void {
    if (!input.sessionId || !input.toolName || !input.catalogRevision) return;
    const now = input.now ?? Date.now();
    const entries = this.session(input.sessionId);
    const previous = entries.get(input.toolName);
    entries.set(input.toolName, {
      toolName: input.toolName,
      catalogRevision: input.catalogRevision,
      contractDigest: input.contractDigest,
      query: previous && sameContract(previous, input) ? previous.query : undefined,
      arguments: previous && sameContract(previous, input) ? previous.arguments : undefined,
      confirmedAt: previous && sameContract(previous, input) ? previous.confirmedAt : now,
      lastUsedAt: now,
    });
    this.trimEntries(entries);
  }

  rememberInvocation(input: {
    sessionId?: string;
    toolName: string;
    catalogRevision: string;
    contractDigest?: string;
    query?: string;
    arguments: Record<string, unknown>;
    now?: number;
  }): void {
    if (!input.sessionId || !input.toolName || !input.catalogRevision) return;
    const now = input.now ?? Date.now();
    const entries = this.session(input.sessionId);
    const previous = entries.get(input.toolName);
    const query =
      normalizeQuery(input.query) ?? (previous && sameContract(previous, input) ? previous.query : undefined);
    entries.set(input.toolName, {
      toolName: input.toolName,
      catalogRevision: input.catalogRevision,
      contractDigest: input.contractDigest,
      ...(query ? { query } : {}),
      arguments: cloneArguments(input.arguments),
      confirmedAt: previous && sameContract(previous, input) ? previous.confirmedAt : now,
      lastUsedAt: now,
    });
    this.trimEntries(entries);
  }

  state(input: {
    sessionId?: string;
    toolName: string;
    catalogRevision: string;
    contractDigest?: string;
  }): AgentToolCapabilityCacheState {
    if (!input.sessionId) return { contract: "unconfirmed", reuse: "none" };
    const entry = this.sessions.get(input.sessionId)?.get(input.toolName);
    if (!entry || !sameContract(entry, input)) return { contract: "unconfirmed", reuse: "none" };
    entry.lastUsedAt = Date.now();
    return entry.arguments
      ? { contract: "confirmed", reuse: "arguments", reusableArguments: entry.arguments }
      : { contract: "confirmed", reuse: "none" };
  }

  getReusable(input: {
    sessionId?: string;
    toolName: string;
    catalogRevision: string;
    contractDigest?: string;
  }): AgentToolCapabilityCacheEntry | undefined {
    if (!input.sessionId) return undefined;
    const entry = this.sessions.get(input.sessionId)?.get(input.toolName);
    if (!entry || !entry.arguments || !sameContract(entry, input)) return undefined;
    entry.lastUsedAt = Date.now();
    return freezeEntry(entry);
  }

  snapshot(sessionId?: string): readonly AgentToolCapabilityCacheEntry[] {
    if (!sessionId) return [];
    return [...(this.sessions.get(sessionId)?.values() ?? [])]
      .sort((left, right) => right.lastUsedAt - left.lastUsedAt || left.toolName.localeCompare(right.toolName))
      .map(freezeEntry);
  }

  invalidateCatalog(catalogRevision: string): void {
    for (const [sessionId, entries] of this.sessions) {
      for (const [toolName, entry] of entries) {
        if (entry.catalogRevision !== catalogRevision) entries.delete(toolName);
      }
      if (entries.size === 0) this.sessions.delete(sessionId);
    }
  }

  clear(sessionId?: string): void {
    if (sessionId) this.sessions.delete(sessionId);
    else this.sessions.clear();
  }

  private session(sessionId: string): Map<string, MutableEntry> {
    let entries = this.sessions.get(sessionId);
    if (!entries) {
      entries = new Map();
      this.sessions.set(sessionId, entries);
      this.trimSessions();
    }
    return entries;
  }

  private trimSessions(): void {
    const limit = positiveLimit(this.policy.maxSessions, DefaultPolicy.maxSessions);
    while (this.sessions.size > limit) {
      const oldest = [...this.sessions.entries()].sort(
        (left, right) => oldestEntry(left[1]) - oldestEntry(right[1]),
      )[0];
      if (!oldest) return;
      this.sessions.delete(oldest[0]);
    }
  }

  private trimEntries(entries: Map<string, MutableEntry>): void {
    const limit = positiveLimit(this.policy.maxEntriesPerSession, DefaultPolicy.maxEntriesPerSession);
    while (entries.size > limit) {
      const oldest = [...entries.entries()].sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt)[0];
      if (!oldest) return;
      entries.delete(oldest[0]);
    }
  }
}

function sameContract(
  left: Pick<MutableEntry, "catalogRevision" | "contractDigest">,
  right: Pick<MutableEntry, "catalogRevision" | "contractDigest">,
): boolean {
  return left.catalogRevision === right.catalogRevision && left.contractDigest === right.contractDigest;
}

function cloneArguments(value: Record<string, unknown>): Readonly<Record<string, unknown>> {
  try {
    return Object.freeze(structuredClone(value));
  } catch {
    // Tool arguments are JSON-shaped by the invocation contract. The
    // canonical hash also makes the fallback deterministic for runtimes that
    // do not expose structuredClone.
    const serialized = JSON.stringify(value);
    return Object.freeze(JSON.parse(serialized ?? "{}")) as Readonly<Record<string, unknown>>;
  }
}

function freezeEntry(entry: MutableEntry): AgentToolCapabilityCacheEntry {
  return Object.freeze({
    toolName: entry.toolName,
    catalogRevision: entry.catalogRevision,
    contractDigest: entry.contractDigest,
    ...(entry.query ? { query: entry.query } : {}),
    arguments: entry.arguments,
    confirmedAt: entry.confirmedAt,
    lastUsedAt: entry.lastUsedAt,
  });
}

function oldestEntry(entries: Map<string, MutableEntry>): number {
  return Math.min(...[...entries.values()].map((entry) => entry.lastUsedAt));
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

const MaxCapabilityQueryCharacters = 2_000;

function normalizeQuery(query: string | undefined): string | undefined {
  const normalized = query?.normalize("NFKC").trim();
  return normalized ? normalized.slice(0, MaxCapabilityQueryCharacters) : undefined;
}

export function capabilityArgumentsDigest(arguments_: Readonly<Record<string, unknown>>): string {
  return sha256HexOfCanonicalJson(arguments_);
}
