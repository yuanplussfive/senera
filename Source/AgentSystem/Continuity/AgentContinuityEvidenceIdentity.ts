import type Database from "better-sqlite3";
import { uniqueStrings } from "./AgentContinuitySqliteUtils.js";

export interface AgentContinuityEvidenceGroup {
  readonly key: string;
  readonly sourceRefs: readonly string[];
}

export function groupAgentContinuityEvidenceByEpisode(
  db: Database.Database,
  sourceRefs: readonly string[],
): AgentContinuityEvidenceGroup[] {
  const normalizedRefs = uniqueStrings(sourceRefs);
  if (normalizedRefs.length === 0)
    throw new Error("Continuity evidence requires at least one physical source reference.");
  const readEpisode = db.prepare<[string], { episode_uri: string }>(
    "SELECT episode_uri FROM memory_sources WHERE uri = ?",
  );
  const groups = new Map<string, string[]>();
  for (const sourceRef of normalizedRefs) {
    const evidenceKey = readEpisode.get(sourceRef)?.episode_uri ?? sourceRef;
    groups.set(evidenceKey, [...(groups.get(evidenceKey) ?? []), sourceRef]);
  }
  return [...groups].map(([key, refs]) => ({ key, sourceRefs: refs }));
}
