import { sha256HexOfCanonicalJson } from "./AgentHash.js";

export class AgentScopedRoundRobin<T> {
  private readonly cursors = new Map<string, number>();

  select(scope: unknown, candidates: readonly T[]): T {
    if (candidates.length === 0) throw new Error("Round-robin selection requires at least one candidate.");
    const identity = sha256HexOfCanonicalJson(scope);
    const cursor = this.cursors.get(identity) ?? 0;
    const selected = candidates[cursor % candidates.length];
    if (selected === undefined) throw new Error("Round-robin selection could not resolve a candidate.");
    this.cursors.set(identity, (cursor + 1) % candidates.length);
    return selected;
  }
}
