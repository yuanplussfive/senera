import type { MemoryNode } from "@mem-os/sdk";
import type { AgentMemorySourceRepository } from "../Memory/AgentMemorySourceRepository.js";
import type { AgentBackgroundLearningRequestRecord } from "../Memory/AgentBackgroundLearningRequestLedger.js";
import type { AgentIdentityDisplayValues } from "../Text/AgentTextParts.js";
import type { AgentMemoryLearningLedger } from "./AgentMemoryLearningLedger.js";
import type { AgentMemoryDiarySource } from "./AgentMemoryDiaryContract.js";
import { AgentMemOSFragmentCommitSchema, fragmentSourceRevision, unique } from "./AgentMemOSSemanticLearningSupport.js";
import { projectAgentMemOSSemanticIdentityText } from "./AgentMemOSSemanticIdentity.js";
import { isAgentMemOSLearningMemoryType, readAgentMemOSSemanticMetadata } from "./AgentMemOSSemanticTypes.js";
import { agentMemoryEpisodeDisplayValues, readAgentMemoryEpisodeSubject } from "../Memory/AgentMemoryEpisodeRecords.js";

/** Completed turns own diary coverage; semantic commits only enrich their records. */
export function projectAgentMemoryDiarySources(options: {
  readonly sourceRepository: Pick<AgentMemorySourceRepository, "listCompletedEpisodes" | "listSources">;
  readonly fragments: readonly MemoryNode[];
  /** Newest first, as returned by the background request ledger. */
  readonly requests: readonly AgentBackgroundLearningRequestRecord[];
  readonly learningLedger?: Pick<AgentMemoryLearningLedger, "binding" | "quality">;
  readonly deletedReferences: ReadonlySet<string>;
  readonly identityDisplayValues?: (sessionId?: string) => AgentIdentityDisplayValues;
}): AgentMemoryDiarySource[] {
  const episodes = options.sourceRepository
    .listCompletedEpisodes()
    .filter((episode) => !options.deletedReferences.has(episode.uri));
  const revisions = new Map(episodes.map((episode) => [episode.uri, fragmentSourceRevision(episode)]));
  const latest = new Map<string, AgentBackgroundLearningRequestRecord>();
  const commits = new Map<string, ReturnType<typeof AgentMemOSFragmentCommitSchema.parse>>();
  for (const request of options.requests) {
    const uri = request.entityUri;
    if (!uri || !revisions.has(uri) || request.sourceRevision !== revisions.get(uri)) continue;
    if (!latest.has(uri)) latest.set(uri, request);
    if (request.status === "completed" && !commits.has(uri))
      commits.set(uri, AgentMemOSFragmentCommitSchema.parse(request.metadata));
  }
  const fragmentsByEpisode = new Map<string, MemoryNode[]>();
  for (const node of options.fragments) {
    const metadata = readAgentMemOSSemanticMetadata(node);
    const uri = metadata?.senera_episode_uri;
    if (
      !uri ||
      !commits.get(uri)?.nodeIds.includes(node.id) ||
      metadata.senera_source_uris?.some((source) => options.deletedReferences.has(source))
    )
      continue;
    const group = fragmentsByEpisode.get(uri) ?? [];
    group.push(node);
    fragmentsByEpisode.set(uri, group);
  }
  return episodes.map((episode) => {
    const identity = agentMemoryEpisodeDisplayValues(episode, options.identityDisplayValues?.(episode.sessionId));
    const projectText = (text: string) => projectAgentMemOSSemanticIdentityText(text, identity);
    const fragments = (fragmentsByEpisode.get(episode.uri) ?? []).sort((a, b) => a.id.localeCompare(b.id));
    const commit = commits.get(episode.uri);
    const knowledgeId = commit?.nodeIds[1];
    const weight = knowledgeId ? options.learningLedger?.quality(knowledgeId).weight : undefined;
    const subject =
      options.learningLedger?.binding(episode.sessionId, episode.requestId)?.subjectId ??
      readAgentMemoryEpisodeSubject(episode)?.id;
    const status = latest.get(episode.uri)?.status;
    return {
      id: episode.id,
      occurredAt: episode.completedAt,
      ...(subject ? { subject } : {}),
      userText: projectText(episode.rawUserText),
      assistantText: projectText(episode.assistantText),
      learning: status === "completed" && commit?.nodeIds.length === 0 ? "skipped" : (status ?? "pending"),
      memories: fragments.flatMap((node) =>
        isAgentMemOSLearningMemoryType(node.type)
          ? [{ type: node.type, summary: projectText(node.content), ...(weight === undefined ? {} : { weight }) }]
          : [],
      ),
      episodeUris: [episode.uri],
      sourceUris: unique([
        ...options.sourceRepository.listSources(episode.uri).map((source) => source.uri),
        ...fragments.flatMap((node) => readAgentMemOSSemanticMetadata(node)?.senera_source_uris ?? []),
      ]),
    };
  });
}
