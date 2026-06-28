import type { DefaultTreeAdapterTypes } from "parse5";
import { AgentXmlLexicalScanner } from "./AgentXmlLexicalScanner.js";

export type Parse5Node = DefaultTreeAdapterTypes.Node;
export type Parse5Element = DefaultTreeAdapterTypes.Element;
export type Parse5ElementLocation = NonNullable<Parse5Element["sourceCodeLocation"]>;

export class AgentToolCallsXmlDom {
  constructor(private readonly lexicalScanner = new AgentXmlLexicalScanner()) {}

  findFirstElement(
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

  descendantsByTag(
    node: Parse5Element,
    tagName: string,
  ): Parse5Element[] {
    return this.childNodes(node).flatMap((child) => [
      ...(this.isElement(child) && this.matchesTagName(child, tagName) ? [child] : []),
      ...(this.isElement(child) ? this.descendantsByTag(child, tagName) : []),
    ]);
  }

  childrenByTag(
    node: Parse5Element,
    tagName: string,
  ): Parse5Element[] {
    return this.childNodes(node)
      .filter((child): child is Parse5Element =>
        this.isElement(child) && this.matchesTagName(child, tagName));
  }

  firstChildByTag(
    node: Parse5Element,
    tagName: string,
  ): Parse5Element | undefined {
    return this.childrenByTag(node, tagName)[0];
  }

  textContent(node: Parse5Node): string {
    if ("value" in node && typeof node.value === "string") {
      return node.value;
    }

    return this.childNodes(node)
      .map((child) => this.textContent(child))
      .join("");
  }

  elementLocation(element: Parse5Element): Parse5ElementLocation | undefined {
    return element.sourceCodeLocation ?? undefined;
  }

  hasMatchingElementBoundary(
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

  private isElement(node: Parse5Node): node is Parse5Element {
    return "tagName" in node && typeof node.tagName === "string";
  }

  private matchesTagName(element: Parse5Element, tagName: string): boolean {
    return element.tagName.toLowerCase() === tagName.toLowerCase();
  }

  private childNodes(node: Parse5Node): Parse5Node[] {
    return "childNodes" in node ? [...node.childNodes] : [];
  }
}

