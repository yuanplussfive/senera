import MarkdownIt from "markdown-it";
import type { AgentMarkdownFenceScanner } from "../Xml/AgentMarkdownFenceScanner.js";
import type { AgentTextLocator } from "../Text/AgentTextLocator.js";
import type { PreparedDecisionXmlDocument } from "./AgentDecisionXmlEnvelopeTypes.js";

export class AgentDecisionXmlFenceReader {
  private readonly markdown = new MarkdownIt({
    html: false,
    linkify: false,
    typographer: false,
  });

  constructor(
    private readonly locator: AgentTextLocator,
    private readonly fenceScanner: AgentMarkdownFenceScanner,
    private readonly isAllowedFenceLanguage: (info: string) => boolean,
  ) {}

  prepareDocument(rawText: string): PreparedDecisionXmlDocument {
    const raw = this.locator.stripBom(rawText);
    const standaloneFenceBody = this.unwrapStandaloneFence(raw);

    return standaloneFenceBody !== undefined
      ? {
          raw,
          body: standaloneFenceBody,
          fenced: true,
        }
      : this.unwrapLeadingFence(raw);
  }

  private unwrapStandaloneFence(raw: string): string | undefined {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return undefined;
    }

    const tokens = this.markdown.parse(trimmed, {});
    return tokens.length === 1
      && tokens[0]?.type === "fence"
      && this.isAllowedFenceLanguage(tokens[0].info)
      ? tokens[0].content
      : undefined;
  }

  private unwrapLeadingFence(raw: string): PreparedDecisionXmlDocument {
    const leading = this.locator.readLeadingContent(raw);
    if (leading === undefined) {
      return {
        raw,
        body: raw,
        fenced: false,
      };
    }

    const opening = this.fenceScanner.readOpening(
      leading,
      this.isAllowedFenceLanguage,
    );

    return opening.kind === "absent"
      ? {
          raw,
          body: raw,
          fenced: false,
        }
      : opening.kind === "open"
        ? {
            raw,
            body: leading.slice(opening.bodyOffset ?? 0),
            fenced: true,
          }
        : {
            raw,
            body: raw,
            fenced: false,
          };
  }
}
