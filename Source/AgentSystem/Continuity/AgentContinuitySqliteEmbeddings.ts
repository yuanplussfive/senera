import type Database from "better-sqlite3";
import { sha256Hex } from "../Core/AgentHash.js";
import { uniqueStrings } from "./AgentContinuitySqliteUtils.js";

/** Persisted write-time embedding for one learned observation summary. */
export interface AgentContinuityObservationEmbedding {
  readonly observationUri: string;
  readonly model: string;
  readonly textSha256: string;
  readonly vector: readonly number[];
}

export function agentContinuityEmbeddingTextSha256(text: string): string {
  return sha256Hex(text.trim());
}

export function upsertAgentContinuityObservationEmbeddings(
  db: Database.Database,
  embeddings: readonly AgentContinuityObservationEmbedding[],
  embeddedAt: string,
): number {
  if (embeddings.length === 0) return 0;
  const statement = db.prepare(
    `INSERT INTO continuity_observation_embeddings (
       observation_uri, model, text_sha256, vector_json, dimensions, embedded_at
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(observation_uri) DO UPDATE SET
       model = excluded.model,
       text_sha256 = excluded.text_sha256,
       vector_json = excluded.vector_json,
       dimensions = excluded.dimensions,
       embedded_at = excluded.embedded_at`,
  );
  const run = db.transaction(() => {
    for (const embedding of embeddings) {
      statement.run(
        embedding.observationUri,
        embedding.model,
        embedding.textSha256,
        JSON.stringify(embedding.vector),
        embedding.vector.length,
        embeddedAt,
      );
    }
  });
  run();
  return embeddings.length;
}

export function listAgentContinuityObservationEmbeddings(
  db: Database.Database,
  observationUris: readonly string[],
): Map<string, AgentContinuityObservationEmbedding> {
  const output = new Map<string, AgentContinuityObservationEmbedding>();
  if (observationUris.length === 0) return output;
  for (const chunk of chunked(observationUris, SqliteParameterChunkSize)) {
    const placeholders = "?".repeat(chunk.length).split("").join(", ");
    const rows = db
      .prepare(
        `SELECT observation_uri, model, text_sha256, vector_json
         FROM continuity_observation_embeddings
         WHERE observation_uri IN (${placeholders})`,
      )
      .all(...chunk) as EmbeddingRow[];
    for (const row of rows) {
      const vector = parseVector(row.vector_json);
      if (!vector) continue;
      output.set(row.observation_uri, {
        observationUri: row.observation_uri,
        model: row.model,
        textSha256: row.text_sha256,
        vector,
      });
    }
  }
  return output;
}

export function pruneAgentContinuityObservationEmbeddings(
  db: Database.Database,
  preservedExternalObservationUris: readonly string[] = [],
): number {
  const preserved = new Set(uniqueStrings(preservedExternalObservationUris));
  const rows = db
    .prepare(
      `SELECT embeddings.observation_uri
       FROM continuity_observation_embeddings embeddings
       LEFT JOIN continuity_observations observations
         ON observations.uri = embeddings.observation_uri
       WHERE observations.uri IS NULL`,
    )
    .all() as readonly { observation_uri: string }[];
  const orphanUris = rows.map((row) => row.observation_uri).filter((uri) => !preserved.has(uri));
  return deleteAgentContinuityObservationEmbeddings(db, orphanUris);
}

export function deleteAgentContinuityObservationEmbeddings(
  db: Database.Database,
  observationUris: readonly string[],
): number {
  const normalized = uniqueStrings(observationUris);
  if (normalized.length === 0) return 0;
  let deleted = 0;
  for (const chunk of chunked(normalized, SqliteParameterChunkSize)) {
    const placeholders = chunk.map(() => "?").join(", ");
    deleted += db
      .prepare(`DELETE FROM continuity_observation_embeddings WHERE observation_uri IN (${placeholders})`)
      .run(...chunk).changes;
  }
  return deleted;
}

const SqliteParameterChunkSize = 500;

interface EmbeddingRow {
  readonly observation_uri: string;
  readonly model: string;
  readonly text_sha256: string;
  readonly vector_json: string;
}

function parseVector(value: string): readonly number[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
  const vector = parsed.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
  return vector.length === parsed.length ? vector : undefined;
}

function chunked<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}
