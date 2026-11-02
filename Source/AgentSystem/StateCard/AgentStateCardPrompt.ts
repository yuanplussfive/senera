import { z } from "zod";
import type { AgentStateCardHistoryTurn } from "./AgentStateCardTypes.js";
import { AgentModelTextPreviewer } from "../Text/AgentTextBudget.js";

export const AgentStateCardRewriteSchema = z
  .object({
    topicRelation: z.enum(["continue", "new_topic"]),
    resumeRequestId: z.string().min(1).nullable().optional(),
    standaloneRequest: z.string().trim().min(1),
  })
  .strict();

export const AgentStateCardRewriteSystemPrompt = [
  "Resolve the current user turn into a standalone request and its topic relation.",
  "Restore only referents grounded in the supplied history. Never invent details or answer the request.",
  "Preserve an already self-contained request verbatim.",
  "Return topicRelation (continue or new_topic), standaloneRequest and resumeRequestId.",
  "When this request continues or returns to a known task, choose that task's supplied requestId as resumeRequestId. Use null for a new unrelated task. Never invent a reference. Resuming an earlier task can follow an intervening topic.",
].join("\n");

export function buildAgentStateCardRewriteInput(input: {
  currentRequest: string;
  history: readonly AgentStateCardHistoryTurn[];
  activeSkills?: readonly string[];
  historyBudgetCharacters: number;
  assistantPreviewTokens: number;
  model: string;
  tasks?: readonly { readonly requestId: string; readonly request: string }[];
}): { readonly userPrompt: string; readonly taskRequestIds: readonly string[] } {
  const previewer = new AgentModelTextPreviewer({
    model: input.model,
    tokenLimit: input.assistantPreviewTokens,
    ellipsis: "...",
  });
  const history = [...input.history].reverse().map((turn) => ({
    ...(turn.requestId ? { requestId: turn.requestId } : {}),
    user: turn.request,
    ...(turn.assistant ? { assistant: previewer.preview(turn.assistant).text } : {}),
    ...(turn.tools.length ? { tools: turn.tools } : {}),
  }));
  const catalog = (input.tasks ?? []).map((task) => ({
    requestId: task.requestId,
    request: previewer.preview(task.request).text,
  }));
  const selected: typeof history = [];
  const tasks: typeof catalog = [];
  let characters = JSON.stringify({ history: [], tasks: [] }).length;
  // Alternate recent context and durable task references so neither can consume
  // the entire shared history budget before the other is considered.
  for (let index = 0; index < Math.max(history.length, catalog.length); index += 1) {
    const turn = history[index];
    if (turn) {
      const size = JSON.stringify(turn).length + (selected.length ? 1 : 0);
      if (characters + size <= input.historyBudgetCharacters) {
        selected.unshift(turn);
        characters += size;
      }
    }
    const task = catalog[index];
    if (task) {
      const size = JSON.stringify(task).length + (tasks.length ? 1 : 0);
      if (characters + size <= input.historyBudgetCharacters) {
        tasks.push(task);
        characters += size;
      }
    }
  }
  return {
    taskRequestIds: tasks.map((task) => task.requestId),
    userPrompt: JSON.stringify({
      current: input.currentRequest,
      history: selected,
      ...(tasks.length ? { tasks } : {}),
      ...(input.activeSkills?.length ? { activeSkills: input.activeSkills } : {}),
    }),
  };
}
