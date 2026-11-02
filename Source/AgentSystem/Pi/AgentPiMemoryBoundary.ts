import {
  createInitialSystemMessage,
  getCurrentTools,
  getCurrentSystemPrompt,
  normalizeContext,
  type Context,
} from "@earendil-works/pi-ai";

/** Refreshes only source-backed background context after Pi commits a summary. */
export type AgentPiMemoryBoundaryRefresh = (boundary: {
  readonly id: string;
  readonly summary: string;
}) => Promise<string>;

/** Same complete-prompt projection Pi uses for before_agent_start overrides. */
export function projectAgentPiMemorySystemPrompt(
  context: Context,
  previousHostPrompt: string,
  currentHostPrompt: string,
): Context {
  const transcript = normalizeContext(context);
  const current = getCurrentSystemPrompt(transcript.messages);
  if (current === currentHostPrompt || current.startsWith(currentHostPrompt + "\n\n")) return context;
  if (current !== previousHostPrompt && !current.startsWith(previousHostPrompt + "\n\n"))
    throw new Error("Pi system prompt no longer contains the expected host memory boundary.");
  const systemPrompt = currentHostPrompt + current.slice(previousHostPrompt.length);
  const head = createInitialSystemMessage(systemPrompt, getCurrentTools(transcript.messages));
  return { messages: [...(head ? [head] : []), ...transcript.messages.filter((message) => message.role !== "system")] };
}
