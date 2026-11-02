import {
  createInitialSystemMessage,
  declarationsEqual,
  getCurrentSystemMessage,
  getCurrentTools,
  type Context,
  type Tool,
} from "@earendil-works/pi-ai";

/**
 * Restricts only the tools visible to a native provider. The transcript,
 * system sections, message order, and compaction entries remain Pi-owned.
 */
export function restrictAgentPiNativeTools(context: Context, providerToolNames: readonly string[]): Context {
  const declaredTools = context.tools ?? getCurrentTools(context.messages);
  const toolsByName = indexTools(declaredTools);
  const selectedTools = providerToolNames.map((name) => requireTool(toolsByName, name));
  const hasTranscriptSystemMessage = context.messages.some((message) => message.role === "system");

  if (!hasTranscriptSystemMessage) {
    return { ...context, tools: selectedTools };
  }

  if (sameToolDeclarations(declaredTools, selectedTools)) return context;

  const currentSystemMessage = getCurrentSystemMessage(context.messages);
  const messages = context.messages.filter((message) => message.role !== "system");
  const systemMessage = currentSystemMessage
    ? replaceSystemTools(currentSystemMessage, selectedTools)
    : createInitialSystemMessage(context.systemPrompt, selectedTools);

  return {
    messages: systemMessage ? [systemMessage, ...messages] : messages,
  };
}

function requireTool(toolsByName: ReadonlyMap<string, Tool>, name: string): Tool {
  const tool = toolsByName.get(name);
  if (!tool) throw new Error(`Pi native provider context is missing declared tool: ${name}.`);
  return tool;
}

function indexTools(tools: readonly Tool[]): Map<string, Tool> {
  const byName = new Map<string, Tool>();
  for (const tool of tools) {
    if (byName.has(tool.name)) throw new Error(`Pi native provider received duplicate tool definition: ${tool.name}.`);
    byName.set(tool.name, tool);
  }
  return byName;
}

function sameToolDeclarations(left: readonly Tool[], right: readonly Tool[]): boolean {
  return (
    left.length === right.length &&
    left.every((tool, index) => {
      const candidate = right[index];
      return candidate !== undefined && declarationsEqual(tool, candidate);
    })
  );
}

function replaceSystemTools(
  systemMessage: NonNullable<ReturnType<typeof getCurrentSystemMessage>>,
  tools: readonly Tool[],
): NonNullable<ReturnType<typeof getCurrentSystemMessage>> {
  const { toolsAdded: _toolsAdded, toolsRemoved: _toolsRemoved, ...withoutTools } = systemMessage;
  return tools.length > 0 ? { ...withoutTools, toolsAdded: [...tools] } : withoutTools;
}
