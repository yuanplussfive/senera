export interface AgentPiCompactionPromptInput {
  previousSummary?: string;
  compactedConversation: string;
  splitTurnPrefix?: string;
  objective?: string;
  customInstructions?: string;
  readFiles: string[];
  modifiedFiles: string[];
  evidence: unknown[];
}

export interface AgentPiCompactionRepairInput {
  input: AgentPiCompactionPromptInput;
  invalidSummary: string;
  issues: string[];
}

export function buildAgentPiCompactionPromptJson(
  input: AgentPiCompactionPromptInput,
  directive:
    { stage: "compactPiSession" } | { stage: "repairPiCompaction"; invalidSummary: string; issues: readonly string[] },
): string {
  return JSON.stringify(
    {
      compactionInput: {
        input,
        previousSummary: input.previousSummary,
        directive,
      },
    },
    null,
    2,
  );
}
