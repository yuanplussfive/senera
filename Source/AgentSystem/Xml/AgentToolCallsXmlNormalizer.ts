import { parseFragment } from "parse5";
import { AgentXmlEnvelopeBoundaryScanner } from "./AgentXmlEnvelopeBoundaryScanner.js";
import type { AgentXmlProtocolSpec } from "./AgentXmlPolicy.js";
import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";
import {
  AgentToolCallsXmlCdataReplacement,
  type Replacement,
} from "./AgentToolCallsXmlCdataReplacement.js";
import { AgentToolCallsXmlDom, type Parse5Element } from "./AgentToolCallsXmlDom.js";
import {
  AgentToolCallsXmlLeafRuleReader,
  type ToolLeafRules,
} from "./AgentToolCallsXmlLeafRules.js";

export interface AgentXmlNormalizationResult {
  xml: string;
  changed: boolean;
}

export interface AgentXmlCandidateNormalizer {
  normalize(xmlText: string): AgentXmlNormalizationResult;
}

type ToolProvider = () => readonly RegisteredTool[];

export class AgentToolCallsXmlNormalizer implements AgentXmlCandidateNormalizer {
  private readonly boundaryScanner = new AgentXmlEnvelopeBoundaryScanner();
  private readonly dom = new AgentToolCallsXmlDom();
  private readonly replacements = new AgentToolCallsXmlCdataReplacement(this.dom);
  private readonly leafRuleReader: AgentToolCallsXmlLeafRuleReader;

  constructor(
    private readonly protocol: AgentXmlProtocolSpec,
    tools: ToolProvider,
  ) {
    this.leafRuleReader = new AgentToolCallsXmlLeafRuleReader(protocol, tools);
  }

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
    const root = this.dom.findFirstElement(
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
      xml: this.replacements.applyReplacements(xmlText, replacements),
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
    return this.dom.childrenByTag(root, this.protocol.items.toolCall)
      .flatMap((toolCall) => this.collectToolCallReplacements(source, toolCall));
  }

  private collectToolCallReplacements(
    source: string,
    toolCall: Parse5Element,
  ): Replacement[] {
    const nameElement = this.dom.firstChildByTag(toolCall, this.protocol.toolCall.name);
    const argumentsElement = this.dom.firstChildByTag(toolCall, this.protocol.toolCall.arguments);
    const toolName = nameElement ? this.dom.textContent(nameElement).trim() : "";
    const rules = toolName ? this.leafRuleReader.readRules().get(toolName) : undefined;
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
      .flatMap((tagName) => this.dom.descendantsByTag(argumentsElement, tagName))
      .map((element) => this.replacements.leafReplacement(source, element))
      .filter((replacement): replacement is Replacement => Boolean(replacement));
    const arrayReplacements = [...rules.scalarArrayParents]
      .flatMap((tagName) => this.dom.descendantsByTag(argumentsElement, tagName))
      .flatMap((element) => this.dom.childrenByTag(element, this.protocol.items.arrayItem))
      .map((element) => this.replacements.leafReplacement(source, element))
      .filter((replacement): replacement is Replacement => Boolean(replacement));

    return this.replacements.dedupeReplacements([
      ...scalarReplacements,
      ...arrayReplacements,
    ]);
  }
}

