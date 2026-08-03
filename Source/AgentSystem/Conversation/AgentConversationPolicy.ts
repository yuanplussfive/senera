import type { AgentLanguageModelMessage } from "../ModelEndpoints/AgentLanguageModel.js";
import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";
import { AgentXmlCodec } from "../Xml/AgentXmlCodec.js";
import { createXmlProtocolSpec } from "../Xml/AgentXmlPolicy.js";
import { AgentConversationEntryKinds, type AgentConversationEntry } from "./AgentConversation.js";
import { authoritativeConversationSequence } from "./AgentConversationSequence.js";

export class AgentConversationPolicy {
  private readonly protocol = createXmlProtocolSpec();
  private readonly codec = new AgentXmlCodec(this.protocol);

  materialize(entries: readonly AgentConversationEntry[]): AgentLanguageModelMessage[] {
    return authoritativeConversationSequence(entries).map((entry) =>
      entry.kind === AgentConversationEntryKinds.UserMessage
        ? { role: "user", content: this.renderHistoricalUserMessage(entry) }
        : { role: "assistant", content: entry.xml },
    );
  }

  renderCurrentUserMessage(entry: Extract<AgentConversationEntry, { kind: "user.message" }>): string {
    if (!entry.attachments || entry.attachments.length === 0) return entry.content;

    return this.codec.objectToXml(this.protocol.roots.currentUserMessage, {
      [this.protocol.context.requestId]: entry.requestId,
      [this.protocol.context.timestamp]: entry.timestamp,
      [this.protocol.context.userMessage]: this.userMessagePayload(entry),
    });
  }

  renderHistoricalUserMessage(entry: Extract<AgentConversationEntry, { kind: "user.message" }>): string {
    return this.codec.objectToXml(this.protocol.roots.historicalUserTurn, {
      [this.protocol.context.requestId]: entry.requestId,
      [this.protocol.context.timestamp]: entry.timestamp,
      [this.protocol.context.instruction]:
        "Historical user turn. Use it as conversation context; do not copy the wrapper.",
      [this.protocol.context.userMessage]: this.userMessagePayload(entry),
    });
  }

  private userMessagePayload(
    entry: Pick<Extract<AgentConversationEntry, { kind: "user.message" }>, "content" | "attachments">,
  ): Record<string, unknown> {
    return entry.attachments && entry.attachments.length > 0
      ? {
          content: entry.content,
          attachments: {
            item: entry.attachments.map((attachment, index) => this.projectAttachment(attachment, index)),
          },
        }
      : { content: entry.content };
  }

  private projectAttachment(attachment: AgentUploadAttachment, index: number): Record<string, unknown> {
    return {
      ref: `ATT${index + 1}`,
      uploadUri: attachment.uploadUri,
      name: attachment.name,
      mime: attachment.mime,
      size: attachment.size,
      status: attachment.status,
    };
  }
}
