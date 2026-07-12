import { z } from "zod";
import {
  normalizeToolArrayArgument,
  normalizeToolNumberArgument,
  normalizeToolStringArgument,
} from "../ToolRuntime/AgentToolArgumentNormalization.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { AgentMemorySourceRepository } from "./AgentMemorySourceRepository.js";
import { AgentMemoryTypes } from "./AgentMemorySourceRepository.js";

export const MemoryRecallScopeValues = ["all", ...AgentMemoryTypes] as const;

export const MemoryRecallPolicy = {
  defaultLimit: 5,
  candidateMultiplier: 4,
  minimumCandidatePool: 12,
  rrfK: 60,
} as const;

export const MemoryRecallArgumentsSchema = z
  .object({
    query: z.preprocess(normalizeToolStringArgument, z.string().trim().min(1)),
    scope: z.enum(MemoryRecallScopeValues).optional(),
    limit: z.preprocess(normalizeToolNumberArgument, z.number().int().positive()).optional(),
    refs: z.preprocess(normalizeToolArrayArgument, z.array(z.string().trim().min(1)).min(1)).optional(),
  })
  .strict();

export type MemoryRecallScope = (typeof MemoryRecallScopeValues)[number];
export type MemoryRecallToolArguments = z.infer<typeof MemoryRecallArgumentsSchema>;

export interface MemoryRecallOptions {
  repository: AgentMemorySourceRepository;
  config: AgentSystemConfig;
  signal?: AbortSignal;
}

export interface MemoryRecallRankedEntry {
  memoryUri: string;
  score: number;
}

export interface MemoryRecallRanking {
  name: "exact_ref" | "keyword" | "semantic" | "rerank";
  entries: MemoryRecallRankedEntry[];
}

export interface ConversationRecallRankedEntry {
  episodeUri: string;
  score: number;
}

export interface ConversationRecallRanking {
  name: "exact_ref" | "keyword" | "rerank";
  entries: ConversationRecallRankedEntry[];
}

export interface MemoryRecallResultEntry {
  memoryUri: string;
  type: string;
  subject: string;
  claim: string;
  howToApply: string;
  tags: { item: string[] };
  triggers: { item: string[] };
  sourceRefs: { item: string[] };
  matchedBy: { item: string[] };
  score: number;
  confidence: number;
  updatedAt: string;
  localDate: string;
}

export interface MemoryRecallTurnMessage {
  sourceRef: string;
  text: string;
  summary: string;
}

export interface MemoryRecallTurnEntry {
  episodeUri: string;
  requestId: string;
  userMessage: MemoryRecallTurnMessage;
  assistantMessage: MemoryRecallTurnMessage;
  sourceRefs: { item: string[] };
  matchedBy: { item: string[] };
  score: number;
  startedAt: string;
  completedAt: string;
  localDate: string;
}

export interface MemoryRecallSourceEntry {
  sourceRef: string;
  sourceKind: string;
  role: string;
  summary: string;
  evidenceUri: string;
  artifactUri: string;
  toolName: string;
  createdAt: string;
  localDate: string;
}

export interface MemoryRecallFallbackState {
  used: boolean;
  reason: string;
}

export interface MemoryRecallResult {
  query: string;
  scope: MemoryRecallScope;
  limit: number;
  refs: { item: string[] };
  memories: { item: MemoryRecallResultEntry[] };
  turns: { item: MemoryRecallTurnEntry[] };
  sources: { item: MemoryRecallSourceEntry[] };
  fallback: MemoryRecallFallbackState;
  warnings: { item: string[] };
  guidance: string;
}
