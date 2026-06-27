import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  type AgentConversationEntry,
} from "../AgentConversation.js";
import type { AgentTerminalResult } from "../AgentExecutionProjector.js";
import type { AgentModelProviderMetadata } from "../AgentModelMetadata.js";
import type { TurnUnderstanding } from "../BamlClient/baml_client/types.js";
import { uniqueTrimmed } from "./AgentMemoryCollections.js";
import {
  buildDirectMemoryAnchor,
  buildEpisode,
  buildMemoryCandidate,
  buildMemoryObservation,
  buildNewMemoryItem,
  buildReinforcedMemoryItem,
  buildSources,
  buildUpdatedMemoryItem,
  directWriteAction,
} from "./AgentMemoryRecordFactory.js";
import {
  episodeToRow,
  memoryCandidateToRow,
  memoryItemToRow,
  memoryItemVectorKey,
  memoryItemVectorToRow,
  memoryObservationToRow,
  rowToEpisode,
  rowToMemoryCandidate,
  rowToMemoryItem,
  rowToMemoryItemVector,
  rowToMemoryObservation,
  rowToSource,
  sourceToRow,
} from "./AgentMemoryRowMapper.js";
import {
  configureAgentMemoryDatabase,
  installAgentMemorySchema,
} from "./AgentMemorySqlSchema.js";
import {
  prepareAgentMemorySqlStatements,
  type AgentMemorySqlStatements,
} from "./AgentMemorySqlStatements.js";
import { projectMemoryTime as projectTime } from "./AgentMemoryTime.js";

export const DefaultAgentMemoryDatabasePath = ".senera/Memory.sqlite";
export { DefaultAgentMemoryTimeZone } from "./AgentMemoryTime.js";
export { InMemoryAgentMemorySourceRepository } from "./AgentMemoryInMemorySourceRepository.js";

export type AgentMemoryEpisodeStatus =
  | "completed"
  | "memory_anchor";
export type AgentMemorySourceKind =
  | "user_message"
  | "assistant_final"
  | "tool_evidence"
  | "artifact";
export const AgentMemoryTypes = [
  "profile",
  "preference",
  "knowledge",
  "scene",
] as const;
export type AgentMemoryType = typeof AgentMemoryTypes[number];
export type AgentMemoryItemStatus =
  | "active"
  | "superseded"
  | "archived"
  | "needs_review";
export type AgentMemoryCandidateStatus =
  | "pending"
  | "promoted"
  | "rejected";
export type AgentMemoryLearningOperation =
  | "create"
  | "reinforce"
  | "update"
  | "supersede"
  | "reject";

export interface AgentMemoryEpisodeRecord {
  id: string;
  uri: string;
  sessionId: string;
  requestId: string;
  status: AgentMemoryEpisodeStatus;
  rawUserText: string;
  standaloneRequest: string;
  contextMode: string;
  contextBasis: string;
  topic: string;
  summary: string;
  startedAt: string;
  completedAt: string;
  updatedAt: string;
  startedAtMs: number;
  completedAtMs: number;
  updatedAtMs: number;
  timeZone: string;
  localDate: string;
  localHour: string;
  metadata: Record<string, unknown>;
}

export interface AgentMemorySourceRecord {
  id: string;
  uri: string;
  episodeId: string;
  episodeUri: string;
  sessionId: string;
  requestId: string;
  sourceKind: AgentMemorySourceKind;
  role: string;
  textContent: string | null;
  summary: string | null;
  conversationEntryId: string;
  evidenceUri: string;
  artifactUri: string;
  toolName: string;
  createdAt: string;
  updatedAt: string;
  createdAtMs: number;
  updatedAtMs: number;
  timeZone: string;
  localDate: string;
  localHour: string;
  metadata: Record<string, unknown>;
}

export interface AgentMemoryItemRecord {
  id: string;
  uri: string;
  type: AgentMemoryType;
  subject: string;
  claim: string;
  howToApply: string;
  tags: string[];
  triggers: string[];
  sourceRefs: string[];
  status: AgentMemoryItemStatus;
  confidence: number;
  sessionId: string;
  sourceEpisodeUri: string;
  sourceRequestId: string;
  createdAt: string;
  updatedAt: string;
  createdAtMs: number;
  updatedAtMs: number;
  timeZone: string;
  localDate: string;
  localHour: string;
  metadata: Record<string, unknown>;
}

export interface AgentMemoryItemVectorRecord {
  memoryUri: string;
  model: string;
  dimensions: number;
  embedding: number[];
  updatedAt: string;
  updatedAtMs: number;
}

export interface AgentMemoryItemVectorWrite {
  memoryUri: string;
  model: string;
  embedding: number[];
  updatedAt?: string;
}

export type AgentMemoryDirectWriteOperation =
  | "create"
  | "reinforce"
  | "update"
  | "supersede";

export interface AgentMemoryDirectWriteInput {
  operation: AgentMemoryDirectWriteOperation;
  type: AgentMemoryType;
  subject: string;
  claim: string;
  howToApply: string;
  tags: readonly string[];
  triggers: readonly string[];
  confidence: number;
  targetMemoryUri?: string;
  reason?: string;
  requestId?: string;
  writtenAt?: string;
}

export interface AgentMemoryLearningActionRecord {
  operation: AgentMemoryLearningOperation;
  type: AgentMemoryType;
  subject: string;
  claim: string;
  howToApply: string;
  tags: string[];
  triggers: string[];
  sourceRefs: string[];
  targetMemoryUri?: string;
  reason: string;
  confidence: number;
}

export interface AgentMemoryConsolidationActionRecord extends AgentMemoryLearningActionRecord {
  candidateUris: string[];
}

export interface AgentMemoryCandidateDraft {
  type: AgentMemoryType;
  subject: string;
  claim: string;
  howToApply: string;
  tags: string[];
  triggers: string[];
  sourceRefs: string[];
  reason: string;
  confidence: number;
  embedding?: number[];
}

export interface AgentMemoryCandidateRecord extends AgentMemoryCandidateDraft {
  id: string;
  uri: string;
  status: AgentMemoryCandidateStatus;
  sessionId: string;
  sourceEpisodeUri: string;
  sourceRequestId: string;
  promotedMemoryUri: string;
  createdAt: string;
  updatedAt: string;
  createdAtMs: number;
  updatedAtMs: number;
  timeZone: string;
  localDate: string;
  localHour: string;
  metadata: Record<string, unknown>;
}

export interface AgentMemoryObservationRecord {
  id: string;
  uri: string;
  memoryUri: string;
  operation: AgentMemoryLearningOperation;
  candidateUris: string[];
  sourceRefs: string[];
  reason: string;
  confidence: number;
  sessionId: string;
  sourceEpisodeUri: string;
  sourceRequestId: string;
  createdAt: string;
  createdAtMs: number;
  timeZone: string;
  localDate: string;
  localHour: string;
  metadata: Record<string, unknown>;
}

export interface AgentMemoryRecordedTurn {
  episode: AgentMemoryEpisodeRecord;
  sources: AgentMemorySourceRecord[];
}

export interface AgentMemoryLearningWriteInput {
  episode: AgentMemoryEpisodeRecord;
  actions: readonly AgentMemoryConsolidationActionRecord[];
  learnedAt?: string;
}

export interface AgentMemoryCandidateWriteInput {
  episode: AgentMemoryEpisodeRecord;
  candidates: readonly AgentMemoryCandidateDraft[];
  learnedAt?: string;
}

export interface AgentMemoryCompletedTurnInput {
  sessionId: string;
  requestId: string;
  startedAt: string;
  completedAt: string;
  userEntry: Extract<AgentConversationEntry, { kind: "user.message" }>;
  assistantEntry: Extract<AgentConversationEntry, { kind: "assistant.decision" }>;
  terminal: AgentTerminalResult;
  turnUnderstanding?: TurnUnderstanding;
  conversationEntries: readonly AgentConversationEntry[];
  modelProvider?: AgentModelProviderMetadata;
}

export interface AgentMemorySourceRepository {
  recordCompletedTurn(input: AgentMemoryCompletedTurnInput): AgentMemoryRecordedTurn;
  recordMemoryCandidates(input: AgentMemoryCandidateWriteInput): AgentMemoryCandidateRecord[];
  applyMemoryLearning(input: AgentMemoryLearningWriteInput): AgentMemoryItemRecord[];
  writeDirectMemory(input: AgentMemoryDirectWriteInput): AgentMemoryItemRecord;
  deleteSession(sessionId: string): void;
  deleteFromSessionRequest(sessionId: string, requestId: string): void;
  listEpisodes(sessionId: string): AgentMemoryEpisodeRecord[];
  listCompletedEpisodes(): AgentMemoryEpisodeRecord[];
  findEpisodesByUris(uris: readonly string[]): AgentMemoryEpisodeRecord[];
  listSources(episodeUri: string): AgentMemorySourceRecord[];
  findMemorySourcesByRefs(refs: readonly string[]): AgentMemorySourceRecord[];
  listPendingMemoryCandidates(sessionId: string, type?: AgentMemoryType): AgentMemoryCandidateRecord[];
  listActiveMemoryItems(): AgentMemoryItemRecord[];
  findMemoryItemsByUris(uris: readonly string[]): AgentMemoryItemRecord[];
  listMemoryObservations(memoryUri: string): AgentMemoryObservationRecord[];
  upsertMemoryItemVectors(records: readonly AgentMemoryItemVectorWrite[]): void;
  listMemoryItemVectors(model: string): AgentMemoryItemVectorRecord[];
  close(): void;
}

export class SqliteAgentMemorySourceRepository implements AgentMemorySourceRepository {
  private readonly db: Database.Database;
  private readonly statements: AgentMemorySqlStatements;

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    configureAgentMemoryDatabase(this.db);
    installAgentMemorySchema(this.db);
    this.statements = prepareAgentMemorySqlStatements(this.db);
  }

  recordCompletedTurn(input: AgentMemoryCompletedTurnInput): AgentMemoryRecordedTurn {
    const episode = buildEpisode(input);
    const sources = buildSources(input, episode);
    const persist = this.db.transaction(() => {
      this.statements.upsertEpisodeStmt.run(episodeToRow(episode));
      this.statements.deleteSourcesByEpisodeStmt.run(episode.id);
      for (const source of sources) {
        this.statements.insertSourceStmt.run(sourceToRow(source));
      }
    });
    persist();
    return { episode, sources };
  }

  recordMemoryCandidates(input: AgentMemoryCandidateWriteInput): AgentMemoryCandidateRecord[] {
    const learnedAt = input.learnedAt ?? new Date().toISOString();
    const records = input.candidates.map((candidate) =>
      buildMemoryCandidate(input.episode, candidate, learnedAt));
    const persist = this.db.transaction(() => {
      for (const record of records) {
        this.statements.insertMemoryCandidateStmt.run(memoryCandidateToRow(record));
      }
    });
    persist();
    return records;
  }

  applyMemoryLearning(input: AgentMemoryLearningWriteInput): AgentMemoryItemRecord[] {
    const learnedAt = input.learnedAt ?? new Date().toISOString();
    const written: AgentMemoryItemRecord[] = [];
    const persist = this.db.transaction(() => {
      for (const action of input.actions) {
        if (action.operation === "reject") {
          this.markCandidatesRejected(action.candidateUris, learnedAt);
          continue;
        }

        if (action.operation === "reinforce") {
          const current = this.readExistingMemory(action.targetMemoryUri);
          const item = buildReinforcedMemoryItem(input.episode, current, action, learnedAt);
          this.statements.updateMemoryItemStmt.run(memoryItemToRow(item));
          this.markCandidatesPromoted(action.candidateUris, item.uri, learnedAt);
          this.statements.insertMemoryObservationStmt.run(memoryObservationToRow(
            buildMemoryObservation(input.episode, item.uri, action, learnedAt),
          ));
          written.push(item);
          continue;
        }

        if (action.operation === "update") {
          const current = this.readExistingMemory(action.targetMemoryUri);
          const item = buildUpdatedMemoryItem(input.episode, current, action, learnedAt);
          this.statements.updateMemoryItemStmt.run(memoryItemToRow(item));
          this.markCandidatesPromoted(action.candidateUris, item.uri, learnedAt);
          this.statements.insertMemoryObservationStmt.run(memoryObservationToRow(
            buildMemoryObservation(input.episode, item.uri, action, learnedAt),
          ));
          written.push(item);
          continue;
        }

        if (action.operation === "supersede") {
          this.markSuperseded(action.targetMemoryUri, learnedAt);
        }

        const item = buildNewMemoryItem(input.episode, action, learnedAt);
        this.statements.insertMemoryItemStmt.run(memoryItemToRow(item));
        this.markCandidatesPromoted(action.candidateUris, item.uri, learnedAt);
        this.statements.insertMemoryObservationStmt.run(memoryObservationToRow(
          buildMemoryObservation(input.episode, item.uri, action, learnedAt),
        ));
        written.push(item);
      }
    });
    persist();
    return written;
  }

  writeDirectMemory(input: AgentMemoryDirectWriteInput): AgentMemoryItemRecord {
    const writtenAt = input.writtenAt ?? new Date().toISOString();
    const anchor = buildDirectMemoryAnchor(input.requestId, writtenAt);
    const action = directWriteAction(input);
    let written: AgentMemoryItemRecord | undefined;
    const persist = this.db.transaction(() => {
      this.statements.upsertEpisodeStmt.run(episodeToRow(anchor));
      if (action.operation === "reinforce") {
        const current = this.readExistingMemory(action.targetMemoryUri);
        const item = buildReinforcedMemoryItem(anchor, current, action, writtenAt);
        this.statements.updateMemoryItemStmt.run(memoryItemToRow(item));
        this.statements.insertMemoryObservationStmt.run(memoryObservationToRow(
          buildMemoryObservation(anchor, item.uri, action, writtenAt),
        ));
        written = item;
        return;
      }

      if (action.operation === "update") {
        const current = this.readExistingMemory(action.targetMemoryUri);
        const item = buildUpdatedMemoryItem(anchor, current, action, writtenAt);
        this.statements.updateMemoryItemStmt.run(memoryItemToRow(item));
        this.statements.insertMemoryObservationStmt.run(memoryObservationToRow(
          buildMemoryObservation(anchor, item.uri, action, writtenAt),
        ));
        written = item;
        return;
      }

      if (action.operation === "supersede") {
        this.markSuperseded(action.targetMemoryUri, writtenAt);
      }

      const item = buildNewMemoryItem(anchor, action, writtenAt);
      this.statements.insertMemoryItemStmt.run(memoryItemToRow(item));
      this.statements.insertMemoryObservationStmt.run(memoryObservationToRow(
        buildMemoryObservation(anchor, item.uri, action, writtenAt),
      ));
      written = item;
    });
    persist();
    if (!written) {
      throw new Error("Direct memory write did not produce a memory item.");
    }
    return written;
  }

  deleteSession(sessionId: string): void {
    this.statements.deleteSessionStmt.run(sessionId);
  }

  deleteFromSessionRequest(sessionId: string, requestId: string): void {
    const target = this.statements.selectEpisodeForRequestStmt.get(sessionId, requestId);
    if (target) {
      this.statements.deleteEpisodesFromTimeStmt.run(sessionId, target.started_at_ms);
      return;
    }
    this.statements.deleteExactEpisodeStmt.run(sessionId, requestId);
  }

  listEpisodes(sessionId: string): AgentMemoryEpisodeRecord[] {
    return this.statements.listEpisodesStmt.all(sessionId).map(rowToEpisode);
  }

  listCompletedEpisodes(): AgentMemoryEpisodeRecord[] {
    return this.statements.listCompletedEpisodesStmt.all().map(rowToEpisode);
  }

  findEpisodesByUris(uris: readonly string[]): AgentMemoryEpisodeRecord[] {
    return uniqueTrimmed(uris)
      .flatMap((uri) => {
        const row = this.statements.selectEpisodeByUriStmt.get(uri);
        return row ? [rowToEpisode(row)] : [];
      });
  }

  listSources(episodeUri: string): AgentMemorySourceRecord[] {
    return this.statements.listSourcesStmt.all(episodeUri).map(rowToSource);
  }

  findMemorySourcesByRefs(refs: readonly string[]): AgentMemorySourceRecord[] {
    const byUri = new Map<string, AgentMemorySourceRecord>();
    for (const ref of uniqueTrimmed(refs)) {
      const source = this.statements.selectSourceByUriStmt.get(ref);
      if (source) {
        byUri.set(source.uri, rowToSource(source));
      }
      for (const row of this.statements.selectSourcesByEvidenceUriStmt.all(ref)) {
        byUri.set(row.uri, rowToSource(row));
      }
      for (const row of this.statements.selectSourcesByArtifactUriStmt.all(ref)) {
        byUri.set(row.uri, rowToSource(row));
      }
    }
    return [...byUri.values()]
      .sort((left, right) => left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id));
  }

  listPendingMemoryCandidates(sessionId: string, type?: AgentMemoryType): AgentMemoryCandidateRecord[] {
    const rows = type
      ? this.statements.listPendingMemoryCandidatesByTypeStmt.all(sessionId, type)
      : this.statements.listPendingMemoryCandidatesStmt.all(sessionId);
    return rows.map(rowToMemoryCandidate);
  }

  listActiveMemoryItems(): AgentMemoryItemRecord[] {
    return this.statements.listActiveMemoryItemsStmt.all().map(rowToMemoryItem);
  }

  findMemoryItemsByUris(uris: readonly string[]): AgentMemoryItemRecord[] {
    return uniqueTrimmed(uris)
      .flatMap((uri) => {
        const row = this.statements.selectMemoryItemByUriStmt.get(uri);
        return row ? [rowToMemoryItem(row)] : [];
      });
  }

  listMemoryObservations(memoryUri: string): AgentMemoryObservationRecord[] {
    return this.statements.listMemoryObservationsStmt.all(memoryUri).map(rowToMemoryObservation);
  }

  upsertMemoryItemVectors(records: readonly AgentMemoryItemVectorWrite[]): void {
    const persist = this.db.transaction(() => {
      for (const record of records) {
        this.statements.upsertMemoryItemVectorStmt.run(memoryItemVectorToRow(record));
      }
    });
    persist();
  }

  listMemoryItemVectors(model: string): AgentMemoryItemVectorRecord[] {
    return this.statements.listMemoryItemVectorsStmt.all(model).map(rowToMemoryItemVector);
  }

  close(): void {
    this.db.close();
  }

  private readExistingMemory(uri: string | undefined): AgentMemoryItemRecord {
    if (!uri) {
      throw new Error("Memory learning action is missing targetMemoryUri.");
    }
    const row = this.statements.selectMemoryItemByUriStmt.get(uri);
    if (!row) {
      throw new Error(`Memory learning target does not exist: ${uri}`);
    }
    return rowToMemoryItem(row);
  }

  private markSuperseded(uri: string | undefined, updatedAt: string): void {
    const current = this.readExistingMemory(uri);
    const time = projectTime(updatedAt);
    this.statements.supersedeMemoryItemStmt.run(
      updatedAt,
      time.epochMs,
      time.timeZone,
      time.localDate,
      time.localHour,
      current.uri,
    );
  }

  private markCandidatesPromoted(
    candidateUris: readonly string[],
    memoryUri: string,
    updatedAt: string,
  ): void {
    const time = projectTime(updatedAt);
    for (const candidateUri of uniqueTrimmed(candidateUris)) {
      this.statements.promoteMemoryCandidateStmt.run(
        memoryUri,
        updatedAt,
        time.epochMs,
        time.timeZone,
        time.localDate,
        time.localHour,
        candidateUri,
      );
    }
  }

  private markCandidatesRejected(
    candidateUris: readonly string[],
    updatedAt: string,
  ): void {
    const time = projectTime(updatedAt);
    for (const candidateUri of uniqueTrimmed(candidateUris)) {
      this.statements.rejectMemoryCandidateStmt.run(
        updatedAt,
        time.epochMs,
        time.timeZone,
        time.localDate,
        time.localHour,
        candidateUri,
      );
    }
  }
}

export function resolveAgentMemoryDatabasePath(workspaceRoot: string, databasePath = DefaultAgentMemoryDatabasePath): string {
  return path.isAbsolute(databasePath)
    ? path.normalize(databasePath)
    : path.resolve(workspaceRoot, databasePath);
}
