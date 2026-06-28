import type { AgentLanguageModelMessage } from "../ModelEndpoints/AgentLanguageModel.js";
import { matchByKind } from "../Core/AgentMatch.js";
import {
  AgentConversationEntryKinds,
  type AgentConversationEntry,
} from "./AgentConversation.js";
import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";
import { AgentXmlCodec } from "../Xml/AgentXmlCodec.js";
import { AgentXmlParser } from "../Xml/AgentXmlParser.js";
import { AgentPlannerMemoryProjector } from "../Memory/AgentPlannerMemory.js";
import {
  createXmlProtocolSpec,
  listXmlArrayElementNames,
} from "../Xml/AgentXmlPolicy.js";

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
  ToolResults: "tool_results",
} as const;

interface ConversationTurnProjection {
  requestId: string;
  user?: Extract<AgentConversationEntry, { kind: "user.message" }>;
  assistants: Array<Extract<AgentConversationEntry, { kind: "assistant.decision" }>>;
  toolResults: Array<Extract<AgentConversationEntry, { kind: "context.tool_results" }>>;
  evidenceMemory: Array<Extract<AgentConversationEntry, { kind: "tool.evidence_memory" }>>;
}

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
    return this.materializeTurnScoped(entries, policy);
  }

  private materializeTurnScoped(
    entries: readonly AgentConversationEntry[],
    policy: Required<AgentConversationMaterializationOptions>,
  ): AgentLanguageModelMessage[] {
    return this.groupTurns(entries).flatMap((turn) => {
      const messages: AgentLanguageModelMessage[] = [];
      if (turn.user) {
        messages.push({
          role: "user",
          content: this.renderHistoricalUserTurnXml(turn, policy),
        });
      }
      const assistant = this.selectHistoricalAssistant(turn);
      if (assistant) {
        messages.push({
          role: "assistant",
          content: this.renderHistoricalAssistantTurn(assistant),
        });
      }
      return messages;
    });
  }

  private groupTurns(entries: readonly AgentConversationEntry[]): ConversationTurnProjection[] {
    const byRequest = new Map<string, ConversationTurnProjection>();
    const order: ConversationTurnProjection[] = [];

    for (const entry of entries) {
      let turn = byRequest.get(entry.requestId);
      if (!turn) {
        turn = {
          requestId: entry.requestId,
          assistants: [],
          toolResults: [],
          evidenceMemory: [],
        };
        byRequest.set(entry.requestId, turn);
        order.push(turn);
      }

      matchByKind(entry, {
        "user.message": (current) => {
          turn.user = current;
        },
        "assistant.decision": (current) => {
          turn.assistants.push(current);
        },
        "context.tool_results": (current) => {
          turn.toolResults.push(current);
        },
        "planner.journal": () => undefined,
        "planner.state_snapshot": () => undefined,
        "tool.evidence_memory": (current) => {
          turn.evidenceMemory.push(current);
        },
      });
    }

    return order;
  }

  private selectHistoricalAssistant(
    turn: ConversationTurnProjection,
  ): Extract<AgentConversationEntry, { kind: "assistant.decision" }> | undefined {
    return turn.assistants.find((entry) => entry.metadata?.run)
      ?? turn.assistants.at(-1);
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
    return this.codec.objectToXml(this.protocol.roots.readOnlyEvidence, {
      [this.protocol.context.kind]: kind,
      [this.protocol.context.instruction]: "Use this as historical evidence only. Do not copy this wrapper or any internal structure into the current answer.",
      [this.protocol.context.payload]: value,
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

  private renderHistoricalUserTurnXml(
    turn: ConversationTurnProjection,
    policy: Required<AgentConversationMaterializationOptions>,
  ): string {
    const payload = this.userMessagePayload(turn.user as Extract<AgentConversationEntry, { kind: "user.message" }>);
    return this.codec.objectToXml(this.protocol.roots.historicalUserTurn, {
      [this.protocol.context.requestId]: turn.requestId,
      [this.protocol.context.timestamp]: turn.user?.timestamp ?? "",
      [this.protocol.context.instruction]: "Historical user turn. Use it as conversation context; do not copy the wrapper.",
      [this.protocol.context.userMessage]: payload,
      [this.protocol.context.toolEvidenceMemory]: this.projectTurnEvidenceMemory(turn, policy),
      [this.protocol.context.toolResults]: this.projectTurnToolResults(turn, policy),
    });
  }

  private renderHistoricalAssistantTurn(
    entry: Extract<AgentConversationEntry, { kind: "assistant.decision" }>,
  ): string {
    return entry.xml;
  }

  private projectTurnEvidenceMemory(
    turn: ConversationTurnProjection,
    policy: Required<AgentConversationMaterializationOptions>,
  ): Record<string, unknown> | undefined {
    const entries = turn.evidenceMemory.filter((entry) =>
      this.includesRequest(entry.requestId, policy.evidenceMemoryScope));
    const evidence = this.memoryProjector.projectEvidenceMemory(entries);
    return evidence.length > 0
      ? {
          item: evidence,
        }
      : undefined;
  }

  private projectTurnToolResults(
    turn: ConversationTurnProjection,
    policy: Required<AgentConversationMaterializationOptions>,
  ): Record<string, unknown> | undefined {
    const results = turn.toolResults
      .filter((entry) => this.includesToolResults(entry.requestId, policy.toolResultsScope))
      .flatMap((entry) => {
        const parsed = this.tryParseToolResults(entry.xml);
        return parsed?.rootName === this.protocol.roots.toolResults
          ? this.readToolResultItems(parsed.value)
          : [];
      });

    return results.length > 0
      ? {
          [this.protocol.items.toolResult]: results,
        }
      : undefined;
  }

  renderCurrentUserMessage(
    entry: Extract<AgentConversationEntry, { kind: "user.message" }>,
  ): string {
    if (!entry.attachments || entry.attachments.length === 0) {
      return entry.content;
    }

    return this.codec.objectToXml(this.protocol.roots.currentUserMessage, {
      [this.protocol.context.requestId]: entry.requestId,
      [this.protocol.context.timestamp]: entry.timestamp,
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
