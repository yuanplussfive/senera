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
          content: this.renderContextUserMessageXml(current.content),
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

  private renderContextUserMessageXml(content: string): string {
    return this.codec.objectToXml(this.protocol.roots.contextUserMessage, {
      [this.protocol.context.userMessageContent]: content,
    });
  }

  renderContextToolResultsXml(toolResultsXml: string): string {
    const parsed = this.tryParseToolResults(toolResultsXml);

    return parsed?.rootName === this.protocol.roots.toolResults
      ? this.codec.objectToXml(this.protocol.roots.contextToolResults, {
          [this.protocol.items.toolResult]: this.readToolResultItems(parsed.value),
        })
      : this.codec.objectToXml(this.protocol.roots.contextToolResults, {
          [this.protocol.items.toolResult]: [],
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
