import { decodeXML } from "entities";
import { SaxesParser } from "saxes";
import type { Parse5Element } from "./AgentToolCallsXmlDom.js";
import { AgentToolCallsXmlDom } from "./AgentToolCallsXmlDom.js";

export interface Replacement {
  start: number;
  end: number;
  text: string;
}

export class AgentToolCallsXmlCdataReplacement {
  constructor(private readonly dom = new AgentToolCallsXmlDom()) {}

  leafReplacement(
    source: string,
    element: Parse5Element,
  ): Replacement | undefined {
    const location = this.dom.elementLocation(element);
    if (!location?.startTag || !location.endTag) {
      return undefined;
    }

    const start = location.startTag.endOffset;
    const end = location.endTag.startOffset;
    if (!this.dom.hasMatchingElementBoundary(source, element, location)) {
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

  dedupeReplacements(replacements: Replacement[]): Replacement[] {
    return [...new Map(
      replacements.map((replacement) => [
        `${replacement.start}:${replacement.end}`,
        replacement,
      ]),
    ).values()].sort((left, right) => right.start - left.start);
  }

  applyReplacements(
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

