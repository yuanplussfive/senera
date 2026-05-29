import { decodeXML } from "entities";
import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import { SaxesParser } from "saxes";
import type { AgentPromptContractProperty } from "./AgentPromptContractProjector.js";
import { AgentPromptContractProjector } from "./AgentPromptContractProjector.js";
import { AgentXmlEnvelopeBoundaryScanner } from "./AgentXmlEnvelopeBoundaryScanner.js";
import { AgentXmlLexicalScanner } from "./AgentXmlLexicalScanner.js";
import type { AgentXmlProtocolSpec } from "./AgentXmlPolicy.js";
import type { RegisteredTool } from "./Types.js";

export interface AgentXmlNormalizationResult {
  xml: string;
  changed: boolean;
}

export interface AgentXmlCandidateNormalizer {
  normalize(xmlText: string): AgentXmlNormalizationResult;
}

type Parse5Node = DefaultTreeAdapterTypes.Node;
type Parse5Element = DefaultTreeAdapterTypes.Element;
type Parse5ElementLocation = NonNullable<Parse5Element["sourceCodeLocation"]>;

interface ToolLeafRules {
  scalarTags: ReadonlySet<string>;
  scalarArrayParents: ReadonlySet<string>;
}

interface MutableToolLeafRules {
  scalarTags: Set<string>;
  scalarArrayParents: Set<string>;
}

interface Replacement {
  start: number;
  end: number;
  text: string;
}

type ToolProvider = () => readonly RegisteredTool[];

export class AgentToolCallsXmlNormalizer implements AgentXmlCandidateNormalizer {
  private readonly contractProjector = new AgentPromptContractProjector();
  private readonly boundaryScanner = new AgentXmlEnvelopeBoundaryScanner();
  private readonly lexicalScanner = new AgentXmlLexicalScanner();
  private cacheKey = "";
  private cachedRules = new Map<string, ToolLeafRules>();

  constructor(
    private readonly protocol: AgentXmlProtocolSpec,
    private readonly tools: ToolProvider,
  ) {}

  static fromTools(
    tools: ToolProvider,
    protocol: AgentXmlProtocolSpec,
  ): AgentToolCallsXmlNormalizer {
    return new AgentToolCallsXmlNormalizer(protocol, tools);
  }

  normalize(xmlText: string): AgentXmlNormalizationResult {
    const scan = this.boundaryScanner.scanFirstCompleteBoundary(xmlText);
    if (scan.kind === "complete" || this.hasStructuralXmlError(scan.error)) {
      return {
        xml: xmlText,
        changed: false,
      };
    }

    const fragment = parseFragment(xmlText, {
      sourceCodeLocationInfo: true,
    });
    const root = this.findFirstElement(
      fragment,
      this.protocol.roots.toolCalls,
    );
    if (!root) {
      return {
        xml: xmlText,
        changed: false,
      };
    }

    const replacements = this.collectRootReplacements(xmlText, root);
    if (replacements.length === 0) {
      return {
        xml: xmlText,
        changed: false,
      };
    }

    return {
      xml: this.applyReplacements(xmlText, replacements),
      changed: true,
    };
  }

  private hasStructuralXmlError(error: Error | undefined): boolean {
    if (!error) {
      return false;
    }

    return this.isStructuralXmlErrorMessage(error.message);
  }

  private isStructuralXmlErrorMessage(message: string): boolean {
    const text = message.toLowerCase();
    return [
      "disallowed character in tag name",
      "disallowed character in closing tag",
      "unexpected close tag",
      "unmatched closing tag",
    ].some((entry) => text.includes(entry));
  }

  private collectRootReplacements(
    source: string,
    root: Parse5Element,
  ): Replacement[] {
    return this.childrenByTag(root, this.protocol.items.toolCall)
      .flatMap((toolCall) => this.collectToolCallReplacements(source, toolCall));
  }

  private collectToolCallReplacements(
    source: string,
    toolCall: Parse5Element,
  ): Replacement[] {
    const nameElement = this.firstChildByTag(toolCall, this.protocol.toolCall.name);
    const argumentsElement = this.firstChildByTag(toolCall, this.protocol.toolCall.arguments);
    const toolName = nameElement ? this.textContent(nameElement).trim() : "";
    const rules = toolName ? this.readRules().get(toolName) : undefined;
    if (!rules || !argumentsElement) {
      return [];
    }

    return this.collectArgumentReplacements(source, argumentsElement, rules);
  }

  private collectArgumentReplacements(
    source: string,
    argumentsElement: Parse5Element,
    rules: ToolLeafRules,
  ): Replacement[] {
    const scalarReplacements = [...rules.scalarTags]
      .flatMap((tagName) => this.descendantsByTag(argumentsElement, tagName))
      .map((element) => this.leafReplacement(source, element))
      .filter((replacement): replacement is Replacement => Boolean(replacement));
    const arrayReplacements = [...rules.scalarArrayParents]
      .flatMap((tagName) => this.descendantsByTag(argumentsElement, tagName))
      .flatMap((element) => this.childrenByTag(element, this.protocol.items.arrayItem))
      .map((element) => this.leafReplacement(source, element))
      .filter((replacement): replacement is Replacement => Boolean(replacement));

    return this.dedupeReplacements([
      ...scalarReplacements,
      ...arrayReplacements,
    ]);
  }

  private leafReplacement(
    source: string,
    element: Parse5Element,
  ): Replacement | undefined {
    const location = this.elementLocation(element);
    if (!location?.startTag || !location.endTag) {
      return undefined;
    }

    const start = location.startTag.endOffset;
    const end = location.endTag.startOffset;
    if (!this.hasMatchingElementBoundary(source, element, location)) {
      return undefined;
    }

    const content = source.slice(start, end);
    if (this.isCdataOnly(content)) {
      return undefined;
    }
    if (this.containsCdataToken(content)) {
      return undefined;
    }

    return {
      start,
      end,
      text: `<![CDATA[${this.escapeCdata(decodeXML(content.trim()))}]]>`,
    };
  }

  private readRules(): Map<string, ToolLeafRules> {
    const tools = this.tools();
    const cacheKey = tools
      .map((tool) => `${tool.name}\u0000${tool.signatureFile ?? ""}`)
      .join("\u0001");

    if (cacheKey === this.cacheKey) {
      return this.cachedRules;
    }

    this.cacheKey = cacheKey;
    this.cachedRules = new Map(
      tools.flatMap((tool) => {
        const rules = this.readToolRules(tool);
        return rules ? [[tool.name, rules] as const] : [];
      }),
    );
    return this.cachedRules;
  }

  private readToolRules(tool: RegisteredTool): ToolLeafRules | undefined {
    if (!tool.signatureFile) {
      return undefined;
    }

    const contract = this.contractProjector.projectFromFile(tool.signatureFile, "arguments");
    const rules: MutableToolLeafRules = {
      scalarTags: new Set(),
      scalarArrayParents: new Set(),
    };
    contract?.properties.forEach((property) => this.collectRules(property, rules));

    return rules.scalarTags.size > 0 || rules.scalarArrayParents.size > 0
      ? rules
      : undefined;
  }

  private collectRules(
    property: AgentPromptContractProperty,
    rules: MutableToolLeafRules,
    parentTag?: string,
  ): void {
    ({
      scalar: () => this.collectScalarRule(property, rules, parentTag),
      object: () => property.children.forEach((child) =>
        this.collectRules(child, rules, property.name)),
      array: () => this.collectArrayRule(property, rules, parentTag),
    })[property.kind]();
  }

  private collectScalarRule(
    property: AgentPromptContractProperty,
    rules: MutableToolLeafRules,
    parentTag?: string,
  ): void {
    if (property.name === this.protocol.items.arrayItem && parentTag) {
      rules.scalarArrayParents.add(parentTag);
      return;
    }

    rules.scalarTags.add(property.name);
  }

  private collectArrayRule(
    property: AgentPromptContractProperty,
    rules: MutableToolLeafRules,
    parentTag?: string,
  ): void {
    const element = property.element;
    if (!element) {
      return;
    }

    if (element.kind === "scalar") {
      rules.scalarArrayParents.add(
        property.name === this.protocol.items.arrayItem && parentTag
          ? parentTag
          : property.name,
      );
      return;
    }

    if (element.kind === "object") {
      element.children.forEach((child) => this.collectRules(child, rules, property.name));
      return;
    }

    this.collectArrayRule(element, rules, property.name);
  }

  private findFirstElement(
    node: Parse5Node,
    tagName: string,
  ): Parse5Element | undefined {
    if (this.isElement(node) && this.matchesTagName(node, tagName)) {
      return node;
    }

    return this.childNodes(node)
      .map((child) => this.findFirstElement(child, tagName))
      .find((child): child is Parse5Element => Boolean(child));
  }

  private descendantsByTag(
    node: Parse5Element,
    tagName: string,
  ): Parse5Element[] {
    return this.childNodes(node).flatMap((child) => [
      ...(this.isElement(child) && this.matchesTagName(child, tagName) ? [child] : []),
      ...(this.isElement(child) ? this.descendantsByTag(child, tagName) : []),
    ]);
  }

  private childrenByTag(
    node: Parse5Element,
    tagName: string,
  ): Parse5Element[] {
    return this.childNodes(node)
      .filter((child): child is Parse5Element =>
        this.isElement(child) && this.matchesTagName(child, tagName));
  }

  private firstChildByTag(
    node: Parse5Element,
    tagName: string,
  ): Parse5Element | undefined {
    return this.childrenByTag(node, tagName)[0];
  }

  private textContent(node: Parse5Node): string {
    if ("value" in node && typeof node.value === "string") {
      return node.value;
    }

    return this.childNodes(node)
      .map((child) => this.textContent(child))
      .join("");
  }

  private isElement(node: Parse5Node): node is Parse5Element {
    return "tagName" in node && typeof node.tagName === "string";
  }

  private matchesTagName(element: Parse5Element, tagName: string): boolean {
    return element.tagName.toLowerCase() === tagName.toLowerCase();
  }

  private childNodes(node: Parse5Node): Parse5Node[] {
    return "childNodes" in node ? [...node.childNodes] : [];
  }

  private elementLocation(element: Parse5Element): Parse5ElementLocation | undefined {
    return element.sourceCodeLocation ?? undefined;
  }

  private hasMatchingElementBoundary(
    source: string,
    element: Parse5Element,
    location: Parse5ElementLocation,
  ): boolean {
    if (!location.startTag || !location.endTag) {
      return false;
    }

    const startTag = this.lexicalScanner.readLeadingTag(
      source.slice(location.startTag.startOffset, location.startTag.endOffset),
    );
    const endTag = this.lexicalScanner.readLeadingTag(
      source.slice(location.endTag.startOffset, location.endTag.endOffset),
    );

    return startTag?.kind === "open"
      && endTag?.kind === "close"
      && this.matchesTagName(element, startTag.name)
      && this.matchesTagName(element, endTag.name);
  }

  private dedupeReplacements(replacements: Replacement[]): Replacement[] {
    return [...new Map(
      replacements.map((replacement) => [
        `${replacement.start}:${replacement.end}`,
        replacement,
      ]),
    ).values()].sort((left, right) => right.start - left.start);
  }

  private applyReplacements(
    source: string,
    replacements: readonly Replacement[],
  ): string {
    return replacements.reduce(
      (current, replacement) =>
        `${current.slice(0, replacement.start)}${replacement.text}${current.slice(replacement.end)}`,
      source,
    );
  }

  private isCdataOnly(content: string): boolean {
    type ContentEvent = "text" | "cdata" | "element";
    const events: ContentEvent[] = [];
    const parser = new SaxesParser({
      fragment: true,
      xmlns: false,
    });
    let depth = 0;
    let failed = false;

    parser.on("text", (text) => {
      if (depth === 1 && text.trim().length > 0) {
        events.push("text");
      }
    });
    parser.on("cdata", () => {
      if (depth === 1) {
        events.push("cdata");
      }
    });
    parser.on("opentag", () => {
      depth += 1;
      if (depth > 1) {
        events.push("element");
      }
    });
    parser.on("closetag", () => {
      depth = Math.max(0, depth - 1);
    });
    parser.on("error", () => {
      failed = true;
    });

    try {
      parser.write(`<content>${content}</content>`).close();
    } catch {
      failed = true;
    }

    return !failed
      && events.length > 0
      && events.every((event) => event === "cdata");
  }

  private containsCdataToken(content: string): boolean {
    return content.includes("<![CDATA[") || content.includes("]]>");
  }

  private escapeCdata(value: string): string {
    return value.replace(/\]\]>/g, "]]]]><![CDATA[>");
  }
}
