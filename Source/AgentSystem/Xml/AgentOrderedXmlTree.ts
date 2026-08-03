import { XMLParser } from "fast-xml-parser";
import type { XmlPath } from "./AgentXmlParserTypes.js";

export type OrderedXmlContent =
  | {
      kind: "element";
      node: OrderedXmlNode;
    }
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "cdata";
      text: string;
    };

export type OrderedXmlNode = {
  name: string;
  content: OrderedXmlContent[];
  children: OrderedXmlNode[];
  path: XmlPath;
};

export class AgentOrderedXmlTreeParser {
  private readonly parser: XMLParser;

  constructor(options: { allowBooleanAttributes: boolean }) {
    this.parser = new XMLParser({
      preserveOrder: true,
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      allowBooleanAttributes: options.allowBooleanAttributes,
      trimValues: true,
      parseTagValue: false,
      parseAttributeValue: false,
      alwaysCreateTextNode: false,
      cdataPropName: "#cdata",
    });
  }

  parseRoots(xmlText: string): OrderedXmlNode[] {
    const parsed = this.parser.parse(xmlText) as unknown[];
    const roots: OrderedXmlNode[] = [];

    for (const item of parsed) {
      const rootEntry = this.readElementEntry(item);
      if (rootEntry) {
        roots.push(this.toNode(rootEntry, []));
      }
    }

    return roots;
  }

  findNodeByPath(root: OrderedXmlNode, path: readonly string[]): OrderedXmlNode | undefined {
    let current: OrderedXmlNode | undefined = root;

    for (const segment of path) {
      current = current?.children.find((child) => child.name === segment);
      if (!current) {
        return undefined;
      }
    }

    return current;
  }

  private readElementEntry(value: unknown): { name: string; children: unknown[] } | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }

    const record = value as Record<string, unknown>;
    const elementEntries = Object.entries(record).filter(([key]) => key !== "#text" && key !== ":@");

    if (elementEntries.length !== 1) {
      return undefined;
    }

    const [name, children] = elementEntries[0];
    return {
      name,
      children: Array.isArray(children) ? children : [],
    };
  }

  private toNode(entry: { name: string; children: unknown[] }, path: XmlPath): OrderedXmlNode {
    const childOccurrences = new Map<string, number>();
    const content: OrderedXmlContent[] = [];
    const children: OrderedXmlNode[] = [];

    for (const rawChild of entry.children) {
      const text = this.readTextNode(rawChild);
      if (text !== undefined) {
        content.push({
          kind: "text",
          text,
        });
        continue;
      }

      const cdata = this.readCdataNode(rawChild);
      if (cdata !== undefined) {
        content.push({
          kind: "cdata",
          text: cdata,
        });
        continue;
      }

      const childEntry = this.readElementEntry(rawChild);
      if (!childEntry) {
        continue;
      }

      const occurrence = childOccurrences.get(childEntry.name) ?? 0;
      childOccurrences.set(childEntry.name, occurrence + 1);
      const childNode = this.toNode(childEntry, [...path, childEntry.name, occurrence]);
      content.push({
        kind: "element",
        node: childNode,
      });
      children.push(childNode);
    }

    return {
      name: entry.name,
      content,
      children,
      path,
    };
  }

  private readTextNode(value: unknown): string | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }

    const record = value as Record<string, unknown>;
    if (!("#text" in record) || Object.keys(record).length !== 1) {
      return undefined;
    }

    return String(record["#text"] ?? "");
  }

  private readCdataNode(value: unknown): string | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }

    const record = value as Record<string, unknown>;
    if (!("#cdata" in record) || Object.keys(record).length !== 1) {
      return undefined;
    }

    return readTextPayload(record["#cdata"]);
  }
}

function readTextPayload(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return "";
        }

        const record = item as Record<string, unknown>;
        return "#text" in record ? String(record["#text"] ?? "") : "";
      })
      .join("");
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return "#text" in record ? String(record["#text"] ?? "") : "";
  }

  return "";
}
