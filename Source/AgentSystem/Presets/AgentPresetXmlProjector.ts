import { XMLBuilder } from "fast-xml-parser";
import type { AgentParsedPresetDocument, AgentRoleplayPresetDocumentContext } from "./AgentPresetTypes.js";

export class AgentPresetXmlProjector {
  private readonly builder = new XMLBuilder({
    attributeNamePrefix: "@_",
    format: true,
    ignoreAttributes: false,
    suppressEmptyNode: false,
    textNodeName: "#text",
  });

  projectDocument(document: AgentParsedPresetDocument): AgentRoleplayPresetDocumentContext {
    return {
      name: document.name,
      format: document.format,
      title: document.title,
      sizeBytes: document.sizeBytes,
      updatedAt: document.updatedAt,
      xml: this.builder.build({
        document: {
          name: document.name,
          format: document.format,
          title: document.title,
          updated_at: document.updatedAt,
          content: this.projectContent(document),
        },
      }),
    };
  }

  private projectContent(document: AgentParsedPresetDocument): Record<string, unknown> {
    if (document.format === "json") {
      return {
        json: this.projectJsonValue(document.parsedJson),
      };
    }

    return {
      text: {
        "@_format": document.format,
        "#text": document.content,
      },
    };
  }

  private projectJsonValue(value: unknown): Record<string, unknown> {
    if (value === null) {
      return {
        value: {
          "@_type": "null",
        },
      };
    }

    if (Array.isArray(value)) {
      return {
        array: {
          item: value.map((item) => this.projectJsonValue(item)),
        },
      };
    }

    if (typeof value === "object") {
      return {
        object: {
          member: Object.entries(value as Record<string, unknown>).map(([name, child]) => ({
            "@_name": name,
            ...this.projectJsonValue(child),
          })),
        },
      };
    }

    return {
      value: {
        "@_type": typeof value,
        "#text": String(value),
      },
    };
  }
}
