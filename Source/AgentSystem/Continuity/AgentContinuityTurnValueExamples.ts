import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { AgentTurnValueLabel, AgentTurnValueTrainingExample } from "./AgentTurnValueClassifier.js";

export type { AgentTurnValueLabel, AgentTurnValueTrainingExample } from "./AgentTurnValueClassifier.js";

export interface AgentContinuityTurnValueExample extends AgentTurnValueTrainingExample {
  readonly promptHash: string;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
}

export function listAgentContinuityTurnValueExamples(db: Database.Database): AgentContinuityTurnValueExample[] {
  const rows = db
    .prepare<[], TurnValueExampleRow>(
      `SELECT prompt_hash, prompt_text, label, occurrences, first_seen_at, last_seen_at
       FROM continuity_turn_value_examples
       WHERE prompt_text <> ''
       ORDER BY last_seen_at DESC, prompt_hash ASC`,
    )
    .all();
  return rows.map(projectRow);
}

export function recordAgentContinuityTurnValueExample(
  db: Database.Database,
  promptText: string,
  label: AgentTurnValueLabel,
  observedAt: string,
): number {
  const normalizedPrompt = normalizeAgentTurnValuePrompt(promptText);
  if (!normalizedPrompt) throw new Error("A turn value training example requires non-empty prompt text.");
  const promptHash = hashAgentTurnValuePrompt(normalizedPrompt);
  db.prepare(
    `INSERT INTO continuity_turn_value_examples
       (prompt_hash, prompt_text, label, occurrences, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, 1, ?, ?)
     ON CONFLICT(prompt_hash, label) DO UPDATE SET
       occurrences = occurrences + 1,
       last_seen_at = excluded.last_seen_at`,
  ).run(promptHash, normalizedPrompt, label, observedAt, observedAt);
  const row = db
    .prepare<[string, AgentTurnValueLabel], { occurrences: number }>(
      `SELECT occurrences FROM continuity_turn_value_examples
       WHERE prompt_hash = ? AND label = ?`,
    )
    .get(promptHash, label);
  if (!row) throw new Error("Turn value training example was not persisted.");
  return row.occurrences;
}

export function pruneAgentContinuityTurnValueExamples(db: Database.Database, maxEntries: number): number {
  const total = (db.prepare(`SELECT COUNT(*) AS count FROM continuity_turn_value_examples`).get() as { count: number })
    .count;
  if (total <= maxEntries) return 0;
  return db
    .prepare(
      `DELETE FROM continuity_turn_value_examples
       WHERE rowid IN (
         SELECT rowid FROM continuity_turn_value_examples
         ORDER BY last_seen_at ASC, rowid ASC
         LIMIT ?
       )`,
    )
    .run(total - maxEntries).changes;
}

function projectRow(row: TurnValueExampleRow): AgentContinuityTurnValueExample {
  return {
    promptHash: row.prompt_hash,
    promptText: row.prompt_text,
    label: row.label,
    occurrences: row.occurrences,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

export function normalizeAgentTurnValuePrompt(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s,，。.!！?？;；:：]+$/gu, "");
}

export function hashAgentTurnValuePrompt(value: string): string {
  return createHash("sha256").update(normalizeAgentTurnValuePrompt(value)).digest("hex");
}

interface TurnValueExampleRow {
  prompt_hash: string;
  prompt_text: string;
  label: AgentTurnValueLabel;
  occurrences: number;
  first_seen_at: string;
  last_seen_at: string;
}
