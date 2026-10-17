import { z } from "zod";
import type { AgentStateCardHistoryTurn } from "./AgentStateCardTypes.js";
import { AgentModelTextPreviewer } from "../Text/AgentTextBudget.js";

export const AgentStateCardRewriteSchema = z
  .object({
    topicRelation: z.enum(["continue", "new_topic"]),
    standaloneRequest: z.string().trim().min(1),
  })
  .strict();

export const AgentStateCardRewriteSystemPrompt = [
  "Resolve the current user turn into a standalone request and its topic relation.",
  "Restore only referents grounded in the supplied history. Never invent details or answer the request.",
  "Preserve an already self-contained request verbatim.",
  "Return only topicRelation (continue or new_topic) and standaloneRequest.",
].join("\n");

export function buildAgentStateCardRewriteInput(input: {
  currentRequest: string;
  history: readonly AgentStateCardHistoryTurn[];
  activeSkills?: readonly string[];
  historyBudgetCharacters: number;
  assistantPreviewTokens: number;
  model: string;
}): string {
  const previewer = new AgentModelTextPreviewer({
    model: input.model,
    tokenLimit: input.assistantPreviewTokens,
    ellipsis: "...",
  });
  const selected: object[] = [];
  let characters = 0;
  for (let index = input.history.length - 1; index >= 0; index -= 1) {
    const turn = input.history[index]!;
    const entry = {
      user: turn.request,
      ...(turn.assistant ? { assistant: previewer.preview(turn.assistant).text } : {}),
      ...(turn.tools.length ? { tools: turn.tools } : {}),
    };
    const size = JSON.stringify(entry).length;
    if (characters + size > input.historyBudgetCharacters) continue;
    selected.unshift(entry);
    characters += size;
  }
  return JSON.stringify({
    current: input.currentRequest,
    history: selected,
    ...(input.activeSkills?.length ? { activeSkills: input.activeSkills } : {}),
  });
}
