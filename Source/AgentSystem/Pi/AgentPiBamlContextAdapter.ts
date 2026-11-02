import { getCurrentSystemPrompt, getCurrentTools, type Context, type Message } from "@earendil-works/pi-ai";

/**
 * BAML is the only Pi route that needs Senera's transport-neutral planning
 * shape. Native providers receive Pi's transcript directly and do not use
 * this adapter.
 */
export function projectAgentPiBamlContext(context: Context): Context {
  const transcriptSystemPrompt = getCurrentSystemPrompt(context.messages);
  const systemPrompt = context.systemPrompt ?? transcriptSystemPrompt;
  const tools = context.tools ?? getCurrentTools(context.messages);
  const messages = withoutSystemMessages(context.messages);

  return {
    messages,
    ...(systemPrompt ? { systemPrompt } : {}),
    ...(tools.length > 0 ? { tools } : {}),
  };
}

function withoutSystemMessages(messages: readonly Message[]): Message[] {
  return messages.filter((message) => message.role !== "system");
}
