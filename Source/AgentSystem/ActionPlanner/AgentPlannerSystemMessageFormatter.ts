import type { XmlAttribute } from "../Xml/AgentXmlFormat.js";
import {
  isPromptXmlContentEmpty,
  promptXmlJson,
  promptXmlNode,
  promptXmlText,
  serializePromptXmlFragment,
  type AgentPromptXmlContent,
  type AgentPromptXmlNode,
} from "./AgentPromptXml.js";

export interface SystemMessageSectionInput {
  readonly sectionType: string;
  readonly attributes?: readonly XmlAttribute[];
  readonly content: AgentPromptXmlContent;
}

/**
 * Formats independent prompt sections. Section names are validated by the
 * shared serializer, so extensions do not require a central descriptor map.
 */
export function formatSystemMessage(
  sections: readonly SystemMessageSectionInput[],
  options?: { readonly omitEmpty?: boolean },
): string {
  const omitEmpty = options?.omitEmpty ?? false;
  return serializePromptXmlFragment(
    sections.filter((input) => !omitEmpty || !isPromptXmlContentEmpty(input.content)).map(toPromptXmlNode),
  );
}

export function section(
  sectionType: string,
  content: string,
  attributes?: readonly XmlAttribute[],
): SystemMessageSectionInput {
  return { sectionType, content: promptXmlText(content), attributes };
}

export function jsonSection(
  sectionType: string,
  value: unknown,
  attributes?: readonly XmlAttribute[],
): SystemMessageSectionInput {
  return { sectionType, content: promptXmlJson(value), attributes };
}

function toPromptXmlNode(input: SystemMessageSectionInput): AgentPromptXmlNode {
  return promptXmlNode(input.sectionType, input.content, toAttributeRecord(input.attributes));
}

function toAttributeRecord(attributes: readonly XmlAttribute[] | undefined): AgentPromptXmlNode["attributes"] {
  if (!attributes) return undefined;
  return Object.fromEntries(
    attributes.filter((entry): entry is readonly [string, string | number | boolean] => {
      const value = entry[1];
      return value !== null && value !== undefined;
    }),
  );
}
