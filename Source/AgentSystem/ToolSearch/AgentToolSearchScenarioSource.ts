import { z } from "zod";
import type { AgentContinuityMemOSRuntime } from "../Continuity/AgentContinuityMemOSRuntime.js";
import type { AgentToolSearchEpisode } from "./AgentToolSearchMemoryTypes.js";
import { AgentStateCardSchema } from "../StateCard/AgentStateCardTypes.js";
export const AgentToolSearchEpisodeSchema: z.ZodType<AgentToolSearchEpisode> = z
  .object({
    query: z.string(),
    queryTokens: z.array(z.string()),
    plannerTags: z.array(z.string()),
    candidates: z.array(z.string()),
    chosenTools: z.array(z.string()),
    activeSkills: z.array(z.object({ name: z.string(), revision: z.string() }).strict()),
    stateCard: AgentStateCardSchema.optional(),
    outcome: z.enum(["success", "failure", "unknown"]),
    calls: z.array(
      z
        .object({
          toolName: z.string(),
          argumentKeys: z.array(z.string()),
          evidenceKinds: z.array(z.string()),
          status: z.enum(["success", "failure", "empty"]),
          evidenceUris: z.array(z.string()),
          artifactUris: z.array(z.string()),
          hasArtifact: z.boolean(),
          hasEvidence: z.boolean(),
          hasWorkspaceChanges: z.boolean(),
          errorCode: z.string(),
          error: z.string(),
          failureKind: z.string().optional(),
          failureSource: z.string().optional(),
          retryable: z.boolean().optional(),
          score: z.number().min(0).max(1),
        })
        .strict(),
    ),
    finalScore: z.number().min(0).max(1),
    finalOutcome: z
      .object({
        toolExecutionSucceeded: z.boolean(),
        producedEvidence: z.boolean(),
        producedArtifact: z.boolean(),
        changedWorkspace: z.boolean(),
      })
      .strict(),
    projectId: z.string(),
    timestamp: z.number().int().nonnegative(),
  })
  .strict();

export interface AgentToolSearchScenarioMatch {
  readonly id: string;
  readonly episode: AgentToolSearchEpisode;
  readonly score: number;
}
export interface AgentToolSearchScenarioSource {
  search(query: string, projectId: string, limit: number): Promise<readonly AgentToolSearchScenarioMatch[]>;
  record(episode: AgentToolSearchEpisode, source?: { readonly sessionId?: string; readonly requestId?: string }): void;
}
export class AgentToolSearchMemOSScenarioSource implements AgentToolSearchScenarioSource {
  constructor(private readonly memos: AgentContinuityMemOSRuntime) {}
  async search(query: string, projectId: string, limit: number): Promise<readonly AgentToolSearchScenarioMatch[]> {
    const results = await this.memos.searchToolRouting(query, projectId, limit);
    return results.map(({ memory }) => ({
      id: memory.node.id,
      episode: AgentToolSearchEpisodeSchema.parse(JSON.parse(memory.node.content)),
      score: memory.score,
    }));
  }
  record(episode: AgentToolSearchEpisode, source?: { readonly sessionId?: string; readonly requestId?: string }): void {
    const parsed = AgentToolSearchEpisodeSchema.parse(episode);
    if (!source?.sessionId || !source.requestId)
      throw new Error("MemOS scenario learning requires the completed turn's session and request identity.");
    this.memos.recordToolRoutingMemory({
      projectId: parsed.projectId,
      episode: parsed,
      sessionId: source.sessionId,
      requestId: source.requestId,
    });
  }
}
