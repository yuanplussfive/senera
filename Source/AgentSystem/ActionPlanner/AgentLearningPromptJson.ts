import type { AgentAgendaActorRole, AgentAgendaDraft, AgentAgendaRecordKind } from "../Agenda/AgentAgendaTypes.js";
import { renderAgentPromptInputWire } from "../Prompt/AgentPromptContextWireRenderer.js";

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

export interface AgentContinuityEpisodePromptInput {
  timeZone: string;
  completedAt: string;
  /** Sources that may ground a new persisted item. */
  evidence: Array<{
    kind: "user" | "tool";
    text: string;
    toolName?: string;
    facts?: string[];
    createdAt: string;
  }>;
  /** Current-turn assistant output is useful for interpretation, never as evidence. */
  turnContext: Array<{
    kind: "assistant_final";
    text: string;
    createdAt: string;
  }>;
  /** Earlier conversation turns used only to resolve references. */
  referents: Array<{
    role: "user" | "assistant";
    text: string;
    createdAt: string;
  }>;
}

export interface AgentContinuityFactPromptInput extends AgentContinuityEpisodePromptInput {
  /** Current user-owned profile values; model may reuse exact keys for updates. */
  profileCatalog: Record<string, string | number | boolean>;
  /** Current Resident-owned profile values; model may reuse exact keys for self-updates. */
  agentProfileCatalog: Record<string, string | number | boolean>;
  /** Read-only world state. Models reference summaries; the host owns record identities. */
  agendaCatalog: Array<{
    kind: AgentAgendaRecordKind;
    actor: AgentAgendaActorRole;
    summary: string;
    status: string;
    dueAt?: string;
    startsAt?: string;
    endsAt?: string;
  }>;
}

export type AgentContinuityCaptureItemKind = "fact" | "profile" | "agent_profile" | "relation";

/** Deliberately flat model-facing shape. Host code supplies identity and evidence. */
export interface AgentContinuityCaptureItem {
  kind: AgentContinuityCaptureItemKind;
  text?: string;
  key?: string;
  value?: string | number | boolean;
  from?: string;
  relation?: string;
  to?: string;
}

/** A model-facing world change. Host code resolves time, identity, evidence, and authority. */
export type AgentContinuityAgendaDraft = AgentAgendaDraft;

export interface AgentContinuityFactExtractionModel {
  items: AgentContinuityCaptureItem[];
  agenda: AgentContinuityAgendaDraft[];
  needsRulePass: boolean;
}

export interface AgentContinuityRulePromptInput extends AgentContinuityEpisodePromptInput {
  facts: string[];
  stateCatalog: Record<
    string,
    {
      summary: string;
      scope: string;
      currentValue?: string | number | boolean;
      expiresAt?: string;
    }
  >;
  ruleCatalog: Record<
    string,
    {
      title: string;
      effect: string;
      status: string;
      time?: string;
      conditions: Record<
        string,
        {
          summary: string;
          operator: string;
          expected?: string | number | boolean;
        }
      >;
    }
  >;
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

export function buildToolLearningPromptWire(
  input: AgentToolLearningPromptInput,
  directive: AgentToolLearningPromptStage,
): string {
  return renderLearningPromptWire("tool_learning", input, directive);
}

/** @deprecated The returned value is a versioned prompt wire, not bare JSON. */
export const buildToolLearningPromptJson = buildToolLearningPromptWire;

export type AgentContinuityFactPromptStage =
  { stage: "extractContinuityFacts" } | { stage: "repairContinuityFacts"; invalidExtraction: string; issues: string[] };

export function buildAgentContinuityFactPromptWire(
  input: AgentContinuityFactPromptInput,
  directive: AgentContinuityFactPromptStage,
): string {
  return renderLearningPromptWire("continuity_facts", input, directive);
}

/** @deprecated The returned value is a versioned prompt wire, not bare JSON. */
export const buildAgentContinuityFactPromptJson = buildAgentContinuityFactPromptWire;

export type AgentContinuityRulePromptStage =
  { stage: "extractContinuityRules" } | { stage: "repairContinuityRules"; invalidExtraction: string; issues: string[] };

export function buildAgentContinuityRulePromptWire(
  input: AgentContinuityRulePromptInput,
  directive: AgentContinuityRulePromptStage,
): string {
  return renderLearningPromptWire("continuity_rules", input, directive);
}

/** @deprecated The returned value is a versioned prompt wire, not bare JSON. */
export const buildAgentContinuityRulePromptJson = buildAgentContinuityRulePromptWire;

function renderLearningPromptWire(kind: string, context: unknown, directive: unknown): string {
  return renderAgentPromptInputWire({ kind, context, directive }, { estimateTokens: (text) => text.length }).text;
}
