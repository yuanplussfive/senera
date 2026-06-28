export interface AgentToolLearningPromptInput {
  rawUserTurn: string;
  standaloneRequest: string;
  contextMode: string;
  contextBasis: string;
  selectedTools: string[];
  candidateSourceTerms: string[];
  toolTagCatalogByTool: Array<{
    toolName: string;
    tags: string[];
  }>;
  search: {
    query: string;
    plannerTags: string[];
    candidates: string[];
  };
  episode: {
    outcome: string;
    producedEvidence: boolean;
    producedArtifact: boolean;
    changedWorkspace: boolean;
  };
}

export interface AgentMemoryLearningPromptInput {
  memoryTypes: string[];
  episode: {
    episodeUri: string;
    requestId: string;
    standaloneRequest: string;
    contextMode: string;
    contextBasis: string;
    startedAt: string;
    completedAt: string;
    localDate: string;
    localHour: string;
  };
  timeline: Array<{
    index: number;
    role: "user" | "assistant";
    kind: string;
    content: string;
    payloadJson: string;
    evidenceUris: string[];
    artifactUris: string[];
  }>;
  sourceCatalog: Array<{
    sourceRef: string;
    sourceKind: string;
    role: string;
    memoryRole: "support" | "context";
    evidenceUri: string;
    artifactUri: string;
    toolName: string;
    createdAt: string;
  }>;
  supportingSourceRefs: string[];
  contextSourceRefs: string[];
}

export interface AgentMemoryConsolidationPromptInput {
  memoryTypes: string[];
  episode: AgentMemoryLearningPromptInput["episode"];
  candidates: Array<{
    uri: string;
    type: string;
    subject: string;
    claim: string;
    howToApply: string;
    tags: string[];
    triggers: string[];
    sourceRefs: string[];
    reason: string;
    confidence: number;
    createdAt: string;
  }>;
  existingMemories: Array<{
    uri: string;
    type: string;
    subject: string;
    claim: string;
    howToApply: string;
    tags: string[];
    triggers: string[];
    confidence: number;
    updatedAt: string;
  }>;
}

export interface AgentMemoryWriteResolutionPromptInput {
  memoryTypes: string[];
  allowedOperations: string[];
  request: {
    source: "automatic_learning" | "direct_tool";
    requestId: string;
    standaloneRequest: string;
  };
  proposed: {
    operation: string;
    type: string;
    subject: string;
    claim: string;
    howToApply: string;
    tags: string[];
    triggers: string[];
    sourceRefs: string[];
    candidateUris: string[];
    targetMemoryUri?: string;
    reason: string;
    confidence: number;
  };
  similarMemories: Array<{
    uri: string;
    type: string;
    subject: string;
    claim: string;
    howToApply: string;
    tags: string[];
    triggers: string[];
    confidence: number;
    updatedAt: string;
    similarity: number;
  }>;
}

export type AgentToolLearningPromptStage =
  | {
      stage: "learnToolUse";
    }
  | {
      stage: "repairToolLearning";
      invalidLearning: string;
      issues: string[];
    };

export function buildToolLearningPromptJson(
  input: AgentToolLearningPromptInput,
  directive: AgentToolLearningPromptStage,
): string {
  return JSON.stringify({
    context: input,
    directive,
  }, null, 2);
}

export type AgentMemoryLearningPromptStage =
  | {
      stage: "learnMemory";
    }
  | {
      stage: "repairMemoryLearning";
      invalidLearning: string;
      issues: string[];
    };

export function buildMemoryLearningPromptJson(
  input: AgentMemoryLearningPromptInput,
  directive: AgentMemoryLearningPromptStage,
): string {
  return JSON.stringify({
    context: input,
    directive,
  }, null, 2);
}

export type AgentMemoryConsolidationPromptStage =
  | {
      stage: "consolidateMemoryCandidates";
    }
  | {
      stage: "repairMemoryConsolidation";
      invalidConsolidation: string;
      issues: string[];
    };

export function buildMemoryConsolidationPromptJson(
  input: AgentMemoryConsolidationPromptInput,
  directive: AgentMemoryConsolidationPromptStage,
): string {
  return JSON.stringify({
    context: input,
    directive,
  }, null, 2);
}

export type AgentMemoryWriteResolutionPromptStage =
  | {
      stage: "resolveMemoryWrite";
    }
  | {
      stage: "repairMemoryWriteResolution";
      invalidResolution: string;
      issues: string[];
    };

export function buildMemoryWriteResolutionPromptJson(
  input: AgentMemoryWriteResolutionPromptInput,
  directive: AgentMemoryWriteResolutionPromptStage,
): string {
  return JSON.stringify({
    context: input,
    directive,
  }, null, 2);
}
