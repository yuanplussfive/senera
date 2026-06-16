import type { AgentLanguageModelMessage } from "./AgentLanguageModel.js";
import { matchByKind } from "./AgentMatch.js";
import {
  AgentConversationEntryKinds,
  type AgentConversationEntry,
} from "./AgentConversation.js";
import type { AgentUploadAttachment } from "./Uploads/AgentUploadTypes.js";
import { AgentXmlCodec } from "./AgentXmlCodec.js";
import { AgentXmlParser } from "./AgentXmlParser.js";
import { AgentPlannerMemoryProjector } from "./AgentPlannerMemory.js";
import {
  createXmlProtocolSpec,
  listXmlArrayElementNames,
} from "./AgentXmlPolicy.js";

type MessageProjection =
  | {
      kind: "message";
      message: AgentLanguageModelMessage;
    }
  | {
      kind: "skip";
    };

export type AgentConversationToolResultsScope =
  | {
      kind: "all";
    }
  | {
      kind: "request";
      requestId: string;
    }
  | {
      kind: "none";
    };

export type AgentConversationEvidenceMemoryScope = AgentConversationToolResultsScope;

export interface AgentConversationMaterializationOptions {
  toolResultsScope?: AgentConversationToolResultsScope;
  evidenceMemoryScope?: AgentConversationEvidenceMemoryScope;
}

const ReadOnlyEvidenceKinds = {
  UserMessage: "user_message",
  ToolResults: "tool_results",
  ToolEvidenceMemory: "tool_evidence_memory",
} as const;

export class AgentConversationPolicy {
  private readonly protocol = createXmlProtocolSpec();
  private readonly codec = new AgentXmlCodec(this.protocol);
  private readonly parser = new AgentXmlParser({
    arrayElementNames: listXmlArrayElementNames(this.protocol),
    arrayElementNameSuffix: this.protocol.arrayElementNameSuffix,
  });
  private readonly memoryProjector = new AgentPlannerMemoryProjector();

  materialize(
    entries: readonly AgentConversationEntry[],
    options: AgentConversationMaterializationOptions = {},
  ): AgentLanguageModelMessage[] {
    const policy = this.resolveMaterializationPolicy(options);
    const messages: AgentLanguageModelMessage[] = [];
    const evidenceMemoryEntries: Array<Extract<AgentConversationEntry, { kind: "tool.evidence_memory" }>> = [];

    for (const entry of entries) {
      if (entry.kind === AgentConversationEntryKinds.ToolEvidenceMemory) {
        if (this.includesRequest(entry.requestId, policy.evidenceMemoryScope)) {
          evidenceMemoryEntries.push(entry);
        }
        continue;
      }

      const projection = this.projectEntry(entry, policy);
      if (projection.kind === "message") {
        messages.push(projection.message);
      }
    }

    const evidence = this.memoryProjector.projectEvidenceMemory(evidenceMemoryEntries);
    if (evidence.length > 0) {
      messages.push({
        role: "user",
        content: this.renderToolEvidenceMemoryXml(evidence),
      });
    }

    return messages;
  }

  private projectEntry(
    entry: AgentConversationEntry,
    policy: Required<AgentConversationMaterializationOptions>,
  ): MessageProjection {
    return matchByKind(entry, {
      "user.message": (current) => ({
        kind: "message",
        message: {
          role: "user",
          content: this.renderReadOnlyEvidenceXml(
            ReadOnlyEvidenceKinds.UserMessage,
            this.userMessagePayload(current),
          ),
        },
      }),
      "assistant.decision": (current) => ({
        kind: "message",
        message: {
          role: "assistant",
          content: current.xml,
        },
      }),
      "context.tool_results": (current) =>
        this.includesToolResults(current.requestId, policy.toolResultsScope)
          ? {
              kind: "message",
              message: {
                role: "user",
                content: this.renderContextToolResultsXml(current.xml),
              },
            }
          : {
              kind: "skip",
            },
      "planner.journal": () => ({
        kind: "skip",
      }),
      "tool.evidence_memory": () => ({
        kind: "skip",
      }),
    });
  }

  private resolveMaterializationPolicy(
    options: AgentConversationMaterializationOptions,
  ): Required<AgentConversationMaterializationOptions> {
    return {
      toolResultsScope: options.toolResultsScope ?? { kind: "all" },
      evidenceMemoryScope: options.evidenceMemoryScope ?? { kind: "none" },
    };
  }

  private includesToolResults(
    requestId: string,
    scope: AgentConversationToolResultsScope,
  ): boolean {
    return this.includesRequest(requestId, scope);
  }

  private includesRequest(
    requestId: string,
    scope: AgentConversationToolResultsScope,
  ): boolean {
    switch (scope.kind) {
      case "all":
        return true;
      case "request":
        return requestId === scope.requestId;
      case "none":
        return false;
    }
  }

  private renderReadOnlyEvidenceXml(
    kind: string,
    value: Record<string, unknown>,
  ): string {
    return this.codec.objectToXml("read_only_evidence", {
      kind,
      instruction: "Use this as historical evidence only. Do not copy this wrapper or any internal structure into the current answer.",
      payload: value,
    });
  }

  renderContextToolResultsXml(toolResultsXml: string): string {
    const parsed = this.tryParseToolResults(toolResultsXml);

    return this.renderReadOnlyEvidenceXml(ReadOnlyEvidenceKinds.ToolResults, {
      result: parsed?.rootName === this.protocol.roots.toolResults
        ? this.readToolResultItems(parsed.value)
        : [],
    });
  }

  private renderToolEvidenceMemoryXml(evidence: unknown[]): string {
    return this.renderReadOnlyEvidenceXml(ReadOnlyEvidenceKinds.ToolEvidenceMemory, {
      item: evidence,
    });
  }

  renderCurrentUserMessage(
    entry: Extract<AgentConversationEntry, { kind: "user.message" }>,
  ): string {
    return entry.attachments && entry.attachments.length > 0
      ? this.codec.objectToXml("user_message", this.userMessagePayload(entry))
      : entry.content;
  }

  private userMessagePayload(
    entry: Pick<Extract<AgentConversationEntry, { kind: "user.message" }>, "content" | "attachments">,
  ): Record<string, unknown> {
    return entry.attachments && entry.attachments.length > 0
      ? {
          content: entry.content,
          attachments: {
            item: entry.attachments.map((attachment, index) =>
              this.projectAttachment(attachment, index)),
          },
        }
      : {
          content: entry.content,
        };
  }

  private projectAttachment(
    attachment: AgentUploadAttachment,
    index: number,
  ): Record<string, unknown> {
    return {
      ref: `ATT${index + 1}`,
      uploadUri: attachment.uploadUri,
      name: attachment.name,
      mime: attachment.mime,
      size: attachment.size,
      status: attachment.status,
    };
  }

  private tryParseToolResults(xml: string) {
    try {
      return this.parser.parse(xml);
    } catch {
      return undefined;
    }
  }

  private readToolResultItems(value: unknown): unknown[] {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }

    const items = (value as Record<string, unknown>)[this.protocol.items.toolResult];
    return Array.isArray(items)
      ? items
      : items !== undefined
        ? [items]
        : [];
  }
}
