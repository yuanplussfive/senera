import { z } from "zod";
import type { MemoryNode } from "@mem-os/sdk";
import type { AgentMemoryEpisodeRecord, AgentMemorySourceRepository } from "../Memory/AgentMemorySourceRepository.js";
import type { AgentMemoryLearningLedger } from "./AgentMemoryLearningLedger.js";
import { readAgentMemOSSemanticMetadata, type AgentMemOSSemanticMetadata } from "./AgentMemOSSemanticTypes.js";

const SubjectSchema = z.object({ id: z.string().trim().min(1), kind: z.enum(["user", "agent", "unknown"]) });

/** Restore attribution only from exact, retained source identities. Session
 * names, message wording and the absence of channel metadata prove nothing. */
export function createAgentMemoryProvenanceRecovery(
  repository: AgentMemorySourceRepository,
  ledger?: AgentMemoryLearningLedger,
): (node: Pick<MemoryNode, "metadata" | "type">) => AgentMemOSSemanticMetadata | undefined {
  let episodes: AgentMemoryEpisodeRecord[] | undefined;
  const sources = new Map<string, ReadonlySet<string>>();
  return (node) => {
    const metadata = readAgentMemOSSemanticMetadata(node);
    if (
      !metadata ||
      metadata.senera_scope === "period" ||
      (metadata.senera_subject_id && (node.type !== "context" || metadata.senera_task_id))
    )
      return undefined;
    const episodeUri = metadata.senera_episode_uri;
    const sourceUris = metadata.senera_source_uris ?? [];
    const requestIds = metadata.senera_source_request_ids ?? [];
    if (!episodeUri && sourceUris.length === 0 && requestIds.length === 0) return undefined;
    episodes ??= repository.listCompletedEpisodes();
    const sessionIds = new Set(metadata.senera_source_session_ids ?? []);
    const related = episodes.filter((episode) => {
      if (sessionIds.size && !sessionIds.has(episode.sessionId)) return false;
      if (episode.uri === episodeUri || requestIds.includes(episode.requestId)) return true;
      if (!sourceUris.length) return false;
      if (!sources.has(episode.uri))
        sources.set(episode.uri, new Set(repository.listSources(episode.uri).map((s) => s.uri)));
      return sourceUris.some((uri) => sources.get(episode.uri)!.has(uri));
    });
    if (
      !related.length ||
      (episodeUri && !related.some((episode) => episode.uri === episodeUri)) ||
      [...sessionIds].some((id) => !related.some((episode) => episode.sessionId === id)) ||
      requestIds.some((id) => !related.some((episode) => episode.requestId === id))
    )
      return undefined;
    for (const episode of related) {
      if (!sources.has(episode.uri))
        sources.set(episode.uri, new Set(repository.listSources(episode.uri).map((s) => s.uri)));
    }
    if (sourceUris.some((uri) => !related.some((episode) => sources.get(episode.uri)!.has(uri)))) return undefined;
    const identities = related.map((episode) => {
      const subject = SubjectSchema.safeParse(episode.metadata.memorySubject);
      const task = ledger?.binding(episode.sessionId, episode.requestId);
      if (subject.success && task && (subject.data.id !== task.subjectId || subject.data.kind !== task.actorKind))
        return undefined;
      const id = subject.success ? subject.data.id : task?.subjectId;
      const kind = subject.success ? subject.data.kind : task?.actorKind;
      return id && kind !== "unknown" ? { id, taskId: task?.taskId } : undefined;
    });
    if (identities.some((identity) => !identity)) return undefined;
    const subjectIds = new Set(identities.map((identity) => identity!.id));
    if (subjectIds.size !== 1) return undefined;
    const subjectId = identities[0]!.id;
    if (metadata.senera_subject_id && metadata.senera_subject_id !== subjectId) return undefined;
    const taskIds = new Set(identities.map((identity) => identity!.taskId));
    const taskId = taskIds.size === 1 ? identities[0]!.taskId : undefined;
    if (metadata.senera_task_id && metadata.senera_task_id !== taskId) return undefined;
    const recovered = {
      ...metadata,
      senera_subject_id: subjectId,
      ...(node.type === "context" && taskId ? { senera_task_id: taskId } : {}),
    };
    return JSON.stringify(metadata) === JSON.stringify(recovered) ? undefined : recovered;
  };
}
