import { XMLBuilder } from "fast-xml-parser";
import {
  createXmlProtocolSpec,
  listRequiredCdataFieldRules,
  type AgentXmlProtocolSpec,
  type AgentXmlRequiredCdataFieldRule,
} from "./AgentXmlPolicy.js";

export class AgentXmlCodec {
  private readonly builder = new XMLBuilder({
    ignoreAttributes: true,
    format: true,
    suppressEmptyNode: false,
    cdataPropName: "#cdata",
  });
  private readonly requiredCdataRules: readonly AgentXmlRequiredCdataFieldRule[];

  constructor(private readonly protocol: AgentXmlProtocolSpec = createXmlProtocolSpec()) {
    this.requiredCdataRules = listRequiredCdataFieldRules(protocol);
  }

  objectToXml(rootName: string, value: Record<string, unknown>): string {
    return this.builder.build({
      [rootName]: this.normalizeForXml(value, rootName, [rootName]),
    });
  }

  normalizeForXml(value: unknown, keyName = "", path: string[] = []): unknown {
    if (Array.isArray(value)) {
      const normalizedItems = value.map((item) =>
        this.normalizeForXml(item, this.protocol.items.arrayItem, path),
      );
      if (this.isArrayItemKey(keyName)) {
        return normalizedItems;
      }

      return {
        [this.protocol.items.arrayItem]: normalizedItems,
      };
    }

    if (value === null || value === undefined) {
      return "";
    }

    if (typeof value === "object") {
      const normalized: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        normalized[key] = this.normalizeForXml(child, key, [...path, key]);
      }

      return normalized;
    }

    const text = String(value);
    return this.requiresCdata(keyName, path)
      ? { "#cdata": this.escapeCdata(text) }
      : text;
  }

  private isArrayItemKey(keyName: string): boolean {
    return (
      keyName === this.protocol.items.arrayItem ||
      keyName === this.protocol.items.toolResult ||
      keyName === this.protocol.items.toolCall ||
      keyName.endsWith(this.protocol.arrayElementNameSuffix)
    );
  }

  escapeText(value: unknown): string {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  private requiresCdata(keyName: string, path: readonly string[]): boolean {
    if (keyName.length === 0 || path.length === 0) {
      return false;
    }

    return this.requiredCdataRules.some((rule) =>
      rule.root === path[0]
      && rule.path.length === path.length - 1
      && rule.path.every((segment, index) => segment === path[index + 1]));
  }

  private escapeCdata(value: string): string {
    return value.replace(/\]\]>/g, "]]]]><![CDATA[>");
  }
}
