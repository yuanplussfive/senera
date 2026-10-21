import type { AssistantMessage, AssistantMessageEventStream } from "@earendil-works/pi-ai";

/** Emits one already-settled assistant message as a coherent Pi stream. */
export function emitAgentPiAssistantMessage(
  stream: AssistantMessageEventStream,
  message: AssistantMessage,
  options: { readonly started?: boolean } = {},
): void {
  const partial: AssistantMessage = { ...message, content: [], stopReason: "pending" };
  if (!options.started) stream.push({ type: "start", partial: { ...partial } });
  for (const block of message.content) {
    const contentIndex = partial.content.length;
    if (block.type === "text") {
      partial.content = [...partial.content, { type: "text", text: "" }];
      stream.push({ type: "text_start", contentIndex, partial: { ...partial } });
      partial.content[contentIndex] = block;
      if (block.text) stream.push({ type: "text_delta", contentIndex, delta: block.text, partial: { ...partial } });
      stream.push({ type: "text_end", contentIndex, content: block.text, partial: { ...partial } });
      continue;
    }
    if (block.type === "thinking") {
      partial.content = [...partial.content, { type: "thinking", thinking: "" }];
      stream.push({ type: "thinking_start", contentIndex, partial: { ...partial } });
      partial.content[contentIndex] = block;
      if (block.thinking) {
        stream.push({ type: "thinking_delta", contentIndex, delta: block.thinking, partial: { ...partial } });
      }
      stream.push({ type: "thinking_end", contentIndex, content: block.thinking, partial: { ...partial } });
      continue;
    }
    if (block.type !== "toolCall") continue;
    partial.content = [...partial.content, { type: "toolCall", id: block.id, name: block.name, arguments: {} }];
    stream.push({ type: "toolcall_start", contentIndex, partial: { ...partial } });
    stream.push({
      type: "toolcall_delta",
      contentIndex,
      delta: JSON.stringify(block.arguments),
      partial: { ...partial },
    });
    partial.content[contentIndex] = block;
    stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: { ...partial } });
  }
  stream.push({ type: "done", reason: projectStopReason(message), message });
  stream.end(message);
}

function projectStopReason(message: AssistantMessage): "toolUse" | "length" | "stop" {
  return message.stopReason === "toolUse" ? "toolUse" : message.stopReason === "length" ? "length" : "stop";
}
