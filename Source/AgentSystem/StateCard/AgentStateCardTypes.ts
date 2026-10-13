import { z } from "zod";

export const AgentStateCardSchemaVersion = "senera.state_card=v3";

export const AgentStateCardTopicRelations = {
  Continue: "continue",
  NewTopic: "new_topic",
} as const;

export type AgentStateCardTopicRelation =
  (typeof AgentStateCardTopicRelations)[keyof typeof AgentStateCardTopicRelations];

export const AgentStateCardHistoryLayers = {
  Fine: "fine",
  Coarse: "coarse",
} as const;

export type AgentStateCardHistoryLayer = (typeof AgentStateCardHistoryLayers)[keyof typeof AgentStateCardHistoryLayers];

export const AgentStateCardToolStatuses = {
  Success: "success",
  Failure: "failure",
  Empty: "empty",
} as const;

export type AgentStateCardToolStatus = (typeof AgentStateCardToolStatuses)[keyof typeof AgentStateCardToolStatuses];

export interface AgentStateCardToolReference {
  name: string;
  status: AgentStateCardToolStatus;
}

export interface AgentStateCardScene {
  time: string;
  timeZone: string;
}

export interface AgentStateCardHistoryTurn {
  request: string;
  assistant?: string;
  layer: AgentStateCardHistoryLayer;
  tools: readonly AgentStateCardToolReference[];
  artifacts: readonly string[];
}

export interface AgentStateCardCompactionView {
  depth: number;
  summary?: string;
  toolIndex?: readonly AgentStateCardToolReference[];
  artifacts?: readonly string[];
}

export interface AgentStateCardLimits {
  prevRequests: number;
  tools: number;
  artifacts: number;
  skills: number;
  requestChars: number;
}

export interface AgentStateCardBuildInput {
  currentRequest: string;
  history: readonly AgentStateCardHistoryTurn[];
  turnIndex?: number;
  now?: Date;
  activeSkills?: readonly string[];
  compaction?: AgentStateCardCompactionView;
  limits?: Partial<AgentStateCardLimits>;
}

const AgentStateCardToolReferenceSchema = z
  .object({ name: z.string(), status: z.enum(AgentStateCardToolStatuses) })
  .strict();

export const AgentStateCardToolHistorySchema = z
  .object({
    tools: z.array(AgentStateCardToolReferenceSchema),
    artifacts: z.array(z.string()),
  })
  .strict();

/** Shared contract for scenario learning, physical history and semantic learning. */
export const AgentStateCardSchema = z
  .object({
    version: z.literal(AgentStateCardSchemaVersion),
    turnIndex: z.number().int().nonnegative(),
    scene: z.object({ time: z.string(), timeZone: z.string() }).strict(),
    topicRelation: z.enum(AgentStateCardTopicRelations),
    prevRequests: z.array(z.string()),
    lastTools: z.array(AgentStateCardToolReferenceSchema),
    failedTools: z.array(AgentStateCardToolReferenceSchema),
    artifacts: z.array(z.string()),
    activeSkills: z.array(z.string()),
    historyLayer: z.enum(AgentStateCardHistoryLayers),
    compactionDepth: z.number().int().nonnegative(),
    standaloneRequest: z.string(),
  })
  .strict();

export type AgentStateCard = z.infer<typeof AgentStateCardSchema>;
