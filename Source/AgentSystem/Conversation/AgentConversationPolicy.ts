import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";
import { AgentXmlCodec } from "../Xml/AgentXmlCodec.js";
import { createXmlProtocolSpec } from "../Xml/AgentXmlPolicy.js";
import type { AgentConversationEntry } from "./AgentConversation.js";
import { composeAgentTurnRequest } from "../Prompt/AgentTurnRequestComposer.js";
import type { AgentTurnAttachmentReference } from "../Prompt/AgentTurnRequestComposer.js";
import type { AgentInteractionContext } from "../Interaction/AgentInteractionContext.js";

export class AgentConversationPolicy {
  private readonly protocol = createXmlProtocolSpec();
  private readonly codec = new AgentXmlCodec(this.protocol);

  renderCurrentUserMessage(
    entry: Extract<AgentConversationEntry, { kind: "user.message" }>,
    interaction?: AgentInteractionContext,
    attachmentReferences?: readonly AgentTurnAttachmentReference[],
  ): string {
    if ((!entry.attachments || entry.attachments.length === 0) && !interaction) return entry.content;

    if (interaction) {
      return composeAgentTurnRequest({
        userInput: entry.content,
        attachments: entry.attachments,
        attachmentReferences,
        interaction,
        options: { enabled: false, timeZone: "UTC" },
      });
    }

    return this.codec.objectToXml(this.protocol.roots.currentUserMessage, {
      [this.protocol.context.requestId]: entry.requestId,
      [this.protocol.context.timestamp]: entry.timestamp,
      [this.protocol.context.userMessage]: this.userMessagePayload(entry, attachmentReferences),
    });
  }

  private userMessagePayload(
    entry: Pick<Extract<AgentConversationEntry, { kind: "user.message" }>, "content" | "attachments">,
    attachmentReferences?: readonly AgentTurnAttachmentReference[],
  ): Record<string, unknown> {
    return entry.attachments && entry.attachments.length > 0
      ? {
          content: entry.content,
          attachments: {
            item: entry.attachments.map((attachment, index) =>
              this.projectAttachment(attachment, index, attachmentReferences),
            ),
          },
        }
      : { content: entry.content };
  }

  private projectAttachment(
    attachment: AgentUploadAttachment,
    index: number,
    attachmentReferences?: readonly AgentTurnAttachmentReference[],
  ): Record<string, unknown> {
    const reference = attachmentReferences?.find((candidate) => candidate.resourceUri === attachment.resourceUri);
    return {
      ref: `ATT${index + 1}`,
      ...(reference?.filePath ? { localPath: reference.filePath } : {}),
      resourceUri: attachment.resourceUri,
      name: attachment.name,
      mime: attachment.mime,
      size: attachment.size,
      status: attachment.status,
    };
  }
}
