import type { AgentLanguageModelMessage } from "./AgentLanguageModel.js";
import { matchByKind } from "./AgentMatch.js";
import { type AgentConversationEntry } from "./AgentConversation.js";
import { AgentXmlCodec } from "./AgentXmlCodec.js";
import { AgentXmlParser } from "./AgentXmlParser.js";
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

export class AgentConversationPolicy {
  private readonly protocol = createXmlProtocolSpec();
  private readonly codec = new AgentXmlCodec(this.protocol);
  private readonly parser = new AgentXmlParser({
    arrayElementNames: listXmlArrayElementNames(this.protocol),
    arrayElementNameSuffix: this.protocol.arrayElementNameSuffix,
  });

  materialize(entries: readonly AgentConversationEntry[]): AgentLanguageModelMessage[] {
    return entries.flatMap((entry) => {
      const projection = this.projectEntry(entry);
      return projection.kind === "message" ? [projection.message] : [];
    });
  }

  private projectEntry(entry: AgentConversationEntry): MessageProjection {
    return matchByKind(entry, {
      "user.message": (current) => ({
        kind: "message",
        message: {
          role: "user",
          content: this.renderReadOnlyEvidenceXml("user_message", {
            content: current.content,
          }),
        },
      }),
      "assistant.decision": (current) => ({
        kind: "message",
        message: {
          role: "assistant",
          content: current.xml,
        },
      }),
      "context.tool_results": (current) => ({
        kind: "message",
        message: {
          role: "user",
          content: this.renderContextToolResultsXml(current.xml),
        },
      }),
    });
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

    return this.renderReadOnlyEvidenceXml("tool_results", {
      result: parsed?.rootName === this.protocol.roots.toolResults
        ? this.readToolResultItems(parsed.value)
        : [],
    });
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
