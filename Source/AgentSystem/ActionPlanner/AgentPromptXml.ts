import { XMLBuilder } from "fast-xml-parser";
import { stableStringify } from "./AgentActionPlannerProjectionUtils.js";
import { escapeXmlAttribute, escapeXmlText } from "../Xml/AgentXmlFormat.js";

export type AgentPromptXmlScalar = string | number | boolean;

export type AgentPromptXmlContent =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "json"; readonly value: unknown }
  | { readonly kind: "children"; readonly value: readonly AgentPromptXmlNode[] };

export interface AgentPromptXmlNode {
  readonly tag: string;
  readonly attributes?: Readonly<Record<string, AgentPromptXmlScalar | null | undefined>>;
  readonly content?: AgentPromptXmlContent;
}

const XmlNamePattern = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

const PromptXmlBuilder = new XMLBuilder({
  attributeNamePrefix: "@_",
  format: true,
  ignoreAttributes: false,
  maxNestedTags: 64,
  preserveOrder: true,
  processEntities: false,
  suppressEmptyNode: true,
  tagValueProcessor: (_name, value) => escapeXmlText(normalizeXmlCharacters(String(value))),
  attributeValueProcessor: (_name, value) => escapeXmlAttribute(normalizeXmlCharacters(String(value))),
});

export function promptXmlText(value: string): AgentPromptXmlContent {
  return { kind: "text", value };
}

export function promptXmlJson(value: unknown): AgentPromptXmlContent {
  return { kind: "json", value };
}

export function promptXmlChildren(value: readonly AgentPromptXmlNode[]): AgentPromptXmlContent {
  return { kind: "children", value };
}

export function promptXmlNode(
  tag: string,
  content?: AgentPromptXmlContent,
  attributes?: AgentPromptXmlNode["attributes"],
): AgentPromptXmlNode {
  return { tag, content, attributes };
}

export function isPromptXmlContentEmpty(content: AgentPromptXmlContent | undefined): boolean {
  if (!content) return true;
  if (content.kind === "children") return content.value.length === 0;
  if (content.kind === "text") return content.value.trim().length === 0;
  return false;
}

/**
 * Serializes trusted prompt structure through fast-xml-parser. Dynamic values
 * can only enter as text, JSON text, or attributes and are always escaped.
 */
export function serializePromptXml(node: AgentPromptXmlNode): string {
  return PromptXmlBuilder.build([toOrderedXmlNode(node)]).trim();
}

export function serializePromptXmlFragment(nodes: readonly AgentPromptXmlNode[]): string {
  return nodes.map(serializePromptXml).join("\n\n");
}

function toOrderedXmlNode(node: AgentPromptXmlNode): Record<string, unknown> {
  assertXmlName(node.tag, "tag");
  const attributes = toBuilderAttributes(node.attributes);
  return {
    [node.tag]: toBuilderContent(node.content),
    ...(attributes ? { ":@": attributes } : {}),
  };
}

function toBuilderContent(content: AgentPromptXmlContent | undefined): readonly Record<string, unknown>[] {
  if (!content) return [];

  switch (content.kind) {
    case "children":
      return content.value.map(toOrderedXmlNode);
    case "json":
      return toTextEntry(stableStringify(content.value));
    case "text":
      return toTextEntry(content.value);
  }
}

function toTextEntry(value: string): readonly Record<string, unknown>[] {
  const normalized = normalizeXmlCharacters(value).trim();
  return normalized.length > 0 ? [{ "#text": normalized }] : [];
}

function toBuilderAttributes(
  attributes: AgentPromptXmlNode["attributes"],
): Record<string, AgentPromptXmlScalar> | undefined {
  if (!attributes) return undefined;

  const result: Record<string, AgentPromptXmlScalar> = {};
  for (const [name, value] of Object.entries(attributes)) {
    assertXmlName(name, "attribute");
    if (value !== null && value !== undefined) {
      result[`@_${name}`] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function assertXmlName(name: string, kind: "tag" | "attribute"): void {
  if (!XmlNamePattern.test(name)) {
    throw new Error(`Invalid prompt XML ${kind} name: "${name}"`);
  }
}

function normalizeXmlCharacters(value: string): string {
  let normalized = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    const isValid =
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0d ||
      (codePoint !== undefined && codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint !== undefined && codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (codePoint !== undefined && codePoint >= 0x10000 && codePoint <= 0x10ffff);
    normalized += isValid ? character : "\uFFFD";
  }
  return normalized;
}
