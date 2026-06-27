export interface AgentFastContextScoutPlannerPromptInput {
  stage: "planFastContextScout";
  workspaceRoot: string;
  virtualRoot: string;
  question: string;
  queryPlan: {
    item: string[];
  };
  commandBudget: {
    maxRounds: number;
    maxCommandsPerRound: number;
  };
  allowedCommands: {
    item: AgentFastContextScoutCommandDefinition[];
  };
  deterministicCandidates: {
    item: AgentFastContextScoutCandidateSummary[];
  };
  round: number;
  observations: {
    item: AgentFastContextScoutObservation[];
  };
}

export interface AgentFastContextScoutCommandDefinition {
  type: string;
  description: string;
  args: Record<string, unknown>;
}

export interface AgentFastContextScoutCandidateSummary {
  path: string;
  score: number;
  line?: number;
  startLine?: number;
  endLine?: number;
  reason: string;
  focus: string;
}

export interface AgentFastContextScoutObservation {
  round: number;
  command: Record<string, unknown>;
  ok: boolean;
  output: string;
  candidateCount: number;
}

export function buildFastContextScoutPromptJson(
  input: AgentFastContextScoutPlannerPromptInput,
  directive: Record<string, unknown>,
): string {
  return JSON.stringify({
    context: input,
    directive,
  }, null, 2);
}
