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
import { buildMemoryItemVector, memoryItemVectorKey } from "./AgentMemoryRowMapper.js";
import { projectMemoryTime as projectTime } from "./AgentMemoryTime.js";
import type {
  AgentMemoryCandidateRecord,
  AgentMemoryCandidateWriteInput,
  AgentMemoryCompletedTurnInput,
  AgentMemoryDirectWriteInput,
  AgentMemoryEpisodeRecord,
  AgentMemoryItemRecord,
  AgentMemoryItemVectorRecord,
  AgentMemoryItemVectorWrite,
  AgentMemoryLearningWriteInput,
  AgentMemoryObservationRecord,
  AgentMemoryRecordedTurn,
  AgentMemorySourceRecord,
  AgentMemorySourceRepository,
  AgentMemoryType,
} from "./AgentMemorySourceRepository.js";

export class InMemoryAgentMemorySourceRepository implements AgentMemorySourceRepository {
  private readonly episodes = new Map<string, AgentMemoryEpisodeRecord>();
  private readonly sourcesByEpisode = new Map<string, AgentMemorySourceRecord[]>();
  private readonly candidates = new Map<string, AgentMemoryCandidateRecord>();
  private readonly vectors = new Map<string, AgentMemoryItemVectorRecord>();
  private readonly items = new Map<string, AgentMemoryItemRecord>();
  private readonly observations = new Map<string, AgentMemoryObservationRecord>();

  recordCompletedTurn(input: AgentMemoryCompletedTurnInput): AgentMemoryRecordedTurn {
    const episode = buildEpisode(input);
    const sources = buildSources(input, episode);
    this.episodes.set(episode.uri, episode);
    this.sourcesByEpisode.set(episode.uri, sources);
    return { episode, sources };
  }

  recordMemoryCandidates(input: AgentMemoryCandidateWriteInput): AgentMemoryCandidateRecord[] {
    const learnedAt = input.learnedAt ?? new Date().toISOString();
    const records = input.candidates.map((candidate) => buildMemoryCandidate(input.episode, candidate, learnedAt));
    for (const record of records) {
      this.candidates.set(record.uri, record);
    }
    return records;
  }

  applyMemoryLearning(input: AgentMemoryLearningWriteInput): AgentMemoryItemRecord[] {
    const learnedAt = input.learnedAt ?? new Date().toISOString();
    const written: AgentMemoryItemRecord[] = [];
    for (const action of input.actions) {
      if (action.operation === "reject") {
        this.markCandidatesRejected(action.candidateUris, learnedAt);
        continue;
      }

      if (action.operation === "reinforce") {
        const current = this.readExistingMemory(action.targetMemoryUri);
        const item = buildReinforcedMemoryItem(input.episode, current, action, learnedAt);
        this.items.set(item.uri, item);
        this.markCandidatesPromoted(action.candidateUris, item.uri, learnedAt);
        this.recordObservation(buildMemoryObservation(input.episode, item.uri, action, learnedAt));
        written.push(item);
        continue;
      }

      if (action.operation === "update") {
        const current = this.readExistingMemory(action.targetMemoryUri);
        const item = buildUpdatedMemoryItem(input.episode, current, action, learnedAt);
        this.items.set(item.uri, item);
        this.markCandidatesPromoted(action.candidateUris, item.uri, learnedAt);
        this.recordObservation(buildMemoryObservation(input.episode, item.uri, action, learnedAt));
        written.push(item);
        continue;
      }

      if (action.operation === "supersede") {
        const current = this.readExistingMemory(action.targetMemoryUri);
        const time = projectTime(learnedAt);
        this.items.set(current.uri, {
          ...current,
          status: "superseded",
          updatedAt: learnedAt,
          updatedAtMs: time.epochMs,
          timeZone: time.timeZone,
          localDate: time.localDate,
          localHour: time.localHour,
        });
      }

      const item = buildNewMemoryItem(input.episode, action, learnedAt);
      this.items.set(item.uri, item);
      this.markCandidatesPromoted(action.candidateUris, item.uri, learnedAt);
      this.recordObservation(buildMemoryObservation(input.episode, item.uri, action, learnedAt));
      written.push(item);
    }
    return written;
  }

  writeDirectMemory(input: AgentMemoryDirectWriteInput): AgentMemoryItemRecord {
    const writtenAt = input.writtenAt ?? new Date().toISOString();
    const anchor = buildDirectMemoryAnchor(input.requestId, writtenAt);
    const action = directWriteAction(input);
    this.episodes.set(anchor.uri, anchor);

    if (action.operation === "reinforce") {
      const current = this.readExistingMemory(action.targetMemoryUri);
      const item = buildReinforcedMemoryItem(anchor, current, action, writtenAt);
      this.items.set(item.uri, item);
      this.recordObservation(buildMemoryObservation(anchor, item.uri, action, writtenAt));
      return item;
    }

    if (action.operation === "update") {
      const current = this.readExistingMemory(action.targetMemoryUri);
      const item = buildUpdatedMemoryItem(anchor, current, action, writtenAt);
      this.items.set(item.uri, item);
      this.recordObservation(buildMemoryObservation(anchor, item.uri, action, writtenAt));
      return item;
    }

    if (action.operation === "supersede") {
      const current = this.readExistingMemory(action.targetMemoryUri);
      const time = projectTime(writtenAt);
      this.items.set(current.uri, {
        ...current,
        status: "superseded",
        updatedAt: writtenAt,
        updatedAtMs: time.epochMs,
        timeZone: time.timeZone,
        localDate: time.localDate,
        localHour: time.localHour,
      });
    }

    const item = buildNewMemoryItem(anchor, action, writtenAt);
    this.items.set(item.uri, item);
    this.recordObservation(buildMemoryObservation(anchor, item.uri, action, writtenAt));
    return item;
  }

  deleteSession(sessionId: string): void {
    for (const episode of this.episodes.values()) {
      if (episode.sessionId !== sessionId) {
        continue;
      }
      this.episodes.delete(episode.uri);
      this.sourcesByEpisode.delete(episode.uri);
    }
    for (const item of this.items.values()) {
      if (item.sessionId === sessionId) {
        this.items.delete(item.uri);
        this.deleteObservationsForMemory(item.uri);
        this.deleteVectorsForMemory(item.uri);
      }
    }
    for (const candidate of this.candidates.values()) {
      if (candidate.sessionId === sessionId) {
        this.candidates.delete(candidate.uri);
      }
    }
  }

  deleteFromSessionRequest(sessionId: string, requestId: string): void {
    const target = [...this.episodes.values()].find(
      (episode) => episode.sessionId === sessionId && episode.requestId === requestId,
    );
    if (!target) {
      return;
    }
    for (const episode of this.episodes.values()) {
      if (episode.sessionId === sessionId && episode.startedAt >= target.startedAt) {
        this.episodes.delete(episode.uri);
        this.sourcesByEpisode.delete(episode.uri);
        for (const item of this.items.values()) {
          if (item.sourceEpisodeUri === episode.uri) {
            this.items.delete(item.uri);
            this.deleteObservationsForMemory(item.uri);
            this.deleteVectorsForMemory(item.uri);
          }
        }
        for (const candidate of this.candidates.values()) {
          if (candidate.sourceEpisodeUri === episode.uri) {
            this.candidates.delete(candidate.uri);
          }
        }
      }
    }
  }

  listEpisodes(sessionId: string): AgentMemoryEpisodeRecord[] {
    return [...this.episodes.values()]
      .filter((episode) => episode.sessionId === sessionId)
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  }

  listCompletedEpisodes(): AgentMemoryEpisodeRecord[] {
    return [...this.episodes.values()]
      .filter((episode) => episode.status === "completed")
      .sort((left, right) => right.completedAtMs - left.completedAtMs || left.id.localeCompare(right.id));
  }

  findEpisodesByUris(uris: readonly string[]): AgentMemoryEpisodeRecord[] {
    return uniqueTrimmed(uris).flatMap((uri) => {
      const episode = this.episodes.get(uri);
      return episode ? [episode] : [];
    });
  }

  listSources(episodeUri: string): AgentMemorySourceRecord[] {
    return [...(this.sourcesByEpisode.get(episodeUri) ?? [])];
  }

  findMemorySourcesByRefs(refs: readonly string[]): AgentMemorySourceRecord[] {
    const refSet = new Set(uniqueTrimmed(refs));
    return [...this.sourcesByEpisode.values()]
      .flat()
      .filter(
        (source) =>
          refSet.has(source.uri) ||
          Boolean(source.evidenceUri && refSet.has(source.evidenceUri)) ||
          Boolean(source.artifactUri && refSet.has(source.artifactUri)),
      )
      .sort((left, right) => left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id));
  }

  listPendingMemoryCandidates(sessionId: string, type?: AgentMemoryType): AgentMemoryCandidateRecord[] {
    return [...this.candidates.values()]
      .filter(
        (candidate) =>
          candidate.sessionId === sessionId && candidate.status === "pending" && (!type || candidate.type === type),
      )
      .sort((left, right) => left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id));
  }

  listActiveMemoryItems(): AgentMemoryItemRecord[] {
    return [...this.items.values()]
      .filter((item) => item.status === "active")
      .sort((left, right) => right.updatedAtMs - left.updatedAtMs || left.id.localeCompare(right.id));
  }

  findMemoryItemsByUris(uris: readonly string[]): AgentMemoryItemRecord[] {
    return uniqueTrimmed(uris).flatMap((uri) => {
      const item = this.items.get(uri);
      return item ? [item] : [];
    });
  }

  listMemoryObservations(memoryUri: string): AgentMemoryObservationRecord[] {
    return [...this.observations.values()]
      .filter((observation) => observation.memoryUri === memoryUri)
      .sort((left, right) => left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id));
  }

  upsertMemoryItemVectors(records: readonly AgentMemoryItemVectorWrite[]): void {
    for (const record of records) {
      const row = buildMemoryItemVector(record);
      this.vectors.set(memoryItemVectorKey(row.memoryUri, row.model), row);
    }
  }

  listMemoryItemVectors(model: string): AgentMemoryItemVectorRecord[] {
    return [...this.vectors.values()]
      .filter((record) => record.model === model)
      .sort((left, right) => right.updatedAtMs - left.updatedAtMs || left.memoryUri.localeCompare(right.memoryUri));
  }

  close(): void {}

  private readExistingMemory(uri: string | undefined): AgentMemoryItemRecord {
    const item = uri ? this.items.get(uri) : undefined;
    if (!item) {
      throw new Error(`Memory learning target does not exist: ${uri ?? ""}`);
    }
    return item;
  }

  private markCandidatesPromoted(candidateUris: readonly string[], memoryUri: string, updatedAt: string): void {
    const time = projectTime(updatedAt);
    for (const candidateUri of uniqueTrimmed(candidateUris)) {
      const candidate = this.candidates.get(candidateUri);
      if (candidate) {
        this.candidates.set(candidateUri, {
          ...candidate,
          status: "promoted",
          promotedMemoryUri: memoryUri,
          updatedAt,
          updatedAtMs: time.epochMs,
          timeZone: time.timeZone,
          localDate: time.localDate,
          localHour: time.localHour,
        });
      }
    }
  }

  private markCandidatesRejected(candidateUris: readonly string[], updatedAt: string): void {
    const time = projectTime(updatedAt);
    for (const candidateUri of uniqueTrimmed(candidateUris)) {
      const candidate = this.candidates.get(candidateUri);
      if (candidate) {
        this.candidates.set(candidateUri, {
          ...candidate,
          status: "rejected",
          updatedAt,
          updatedAtMs: time.epochMs,
          timeZone: time.timeZone,
          localDate: time.localDate,
          localHour: time.localHour,
        });
      }
    }
  }

  private recordObservation(record: AgentMemoryObservationRecord): void {
    this.observations.set(record.uri, record);
  }

  private deleteVectorsForMemory(memoryUri: string): void {
    for (const key of this.vectors.keys()) {
      if (key.startsWith(`${memoryUri}\0`)) {
        this.vectors.delete(key);
      }
    }
  }

  private deleteObservationsForMemory(memoryUri: string): void {
    for (const observation of this.observations.values()) {
      if (observation.memoryUri === memoryUri) {
        this.observations.delete(observation.uri);
      }
    }
  }
}
