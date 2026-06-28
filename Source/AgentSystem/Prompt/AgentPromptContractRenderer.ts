import { AgentXmlCodec } from "../Xml/AgentXmlCodec.js";
import type {
  AgentPromptContractProperty,
  ContractProjectionNode,
} from "./AgentPromptContractTypes.js";

export class AgentPromptContractRenderer {
  constructor(
    private readonly options: {
      xmlCodec: AgentXmlCodec;
      arrayItemName: string;
    },
  ) {}

  renderTsHintLines(rootName: string, properties: ContractProjectionNode[]): string[] {
    return [
      `${rootName}: {`,
      ...properties.flatMap((property) => this.renderTsHintProperty(property, 1)),
      "}",
    ];
  }

  renderXmlPreview(rootName: string, properties: ContractProjectionNode[]): string {
    const objectValue = Object.fromEntries(
      properties.map((property) => [property.name, this.renderXmlPreviewValue(property)]),
    );
    return this.options.xmlCodec.objectToXml(rootName, objectValue);
  }

  toPromptProperty(property: ContractProjectionNode): AgentPromptContractProperty {
    return {
      name: property.name,
      displayName: property.displayName,
      path: property.path,
      depth: property.depth,
      kind: property.kind,
      typeText: property.typeText,
      required: property.required,
      comment: property.comment,
      xmlHint: property.xmlHint,
      children: property.children.map((child) => this.toPromptProperty(child)),
      element: property.element ? this.toPromptProperty(property.element) : undefined,
      elements: property.element ? [this.toPromptProperty(property.element)] : [],
    };
  }

  private renderTsHintProperty(property: ContractProjectionNode, depth: number): string[] {
    const indent = "  ".repeat(depth);
    const suffix = property.required ? "" : "?";

    return property.kind === "scalar"
      ? [`${indent}${property.name}${suffix}: ${property.typeText}`]
      : property.kind === "object"
        ? [
            `${indent}${property.name}${suffix}: {`,
            ...property.children.flatMap((child) => this.renderTsHintProperty(child, depth + 1)),
            `${indent}}`,
          ]
        : [
            `${indent}${property.name}${suffix}: [`,
            ...(property.element ? this.renderTsHintArrayElement(property.element, depth + 1) : []),
            `${indent}]`,
          ];
  }

  private renderTsHintArrayElement(property: ContractProjectionNode, depth: number): string[] {
    const indent = "  ".repeat(depth);

    return property.kind === "scalar"
      ? [`${indent}${property.typeText}`]
      : property.kind === "object"
        ? [
            `${indent}{`,
            ...property.children.flatMap((child) => this.renderTsHintProperty(child, depth + 1)),
            `${indent}}`,
          ]
        : [
            `${indent}[`,
            ...(property.element ? this.renderTsHintArrayElement(property.element, depth + 1) : []),
            `${indent}]`,
          ];
  }

  private renderXmlPreviewValue(property: ContractProjectionNode): unknown {
    return property.kind === "scalar"
      ? this.renderLeafPreviewValue(property)
      : property.kind === "object"
        ? Object.fromEntries(
            property.children.map((child) => [child.name, this.renderXmlPreviewValue(child)]),
          )
        : [property.element ? this.renderXmlArrayElementValue(property.element) : this.options.arrayItemName];
  }

  private renderXmlArrayElementValue(property: ContractProjectionNode): unknown {
    return property.kind === "scalar"
      ? this.renderLeafPreviewValue(property)
      : property.kind === "object"
        ? Object.fromEntries(
            property.children.map((child) => [child.name, this.renderXmlPreviewValue(child)]),
          )
        : [property.element ? this.renderXmlArrayElementValue(property.element) : this.options.arrayItemName];
  }

  private renderLeafPreviewValue(property: ContractProjectionNode): string {
    return property.xmlHint || sampleScalar(property.typeText) || property.name;
  }
}

function sampleScalar(typeText: string): string | undefined {
  const normalized = typeText.trim();
  return ({
    string: "text",
    number: "0",
    boolean: "false",
  } as const)[normalized];
}
