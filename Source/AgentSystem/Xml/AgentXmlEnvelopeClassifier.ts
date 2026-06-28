import { AgentXmlLexicalScanner } from "./AgentXmlLexicalScanner.js";
import { AgentMarkdownFenceScanner } from "./AgentMarkdownFenceScanner.js";
import {
  AgentXmlTailKinds,
} from "./AgentXmlStatus.js";
import { matchByKind } from "../AgentMatch.js";
import {
  classifyXmlValidationMessage,
  isIncompleteXmlValidationMessage,
} from "./AgentXmlValidationMessageCatalog.js";

export type AgentXmlFenceTailStatus =
  | {
      kind: "none";
    }
  | {
      kind: "accepted";
      partial: boolean;
    }
  | {
      kind: "trailing_after_fence";
      offset: number;
    };

export type AgentXmlTailClassification =
  | {
      kind: typeof AgentXmlTailKinds.Empty;
    }
  | {
      kind: typeof AgentXmlTailKinds.ClosingFence;
    }
  | {
      kind: typeof AgentXmlTailKinds.ClosingFencePrefix;
    }
  | {
      kind: typeof AgentXmlTailKinds.TrailingText;
      offset: number;
    }
  | {
      kind: typeof AgentXmlTailKinds.OrphanClosingTag;
      offset: number;
      tagName?: string;
    }
  | {
      kind: typeof AgentXmlTailKinds.ExtraRoot;
      offset: number;
    }
  | {
      kind: typeof AgentXmlTailKinds.IncompleteXml;
      offset: number;
      reason: "unexpected_eof";
    };

export class AgentXmlEnvelopeClassifier {
  constructor(
    private readonly scanner: AgentXmlLexicalScanner,
    private readonly fenceScanner: AgentMarkdownFenceScanner,
    private readonly options: {
      readLeadingContent: (text: string) => string | undefined;
      firstNonWhitespaceOffset: (text: string) => number;
      findFirstCompleteBoundary: (xmlText: string, fromOffset?: number) => number | undefined;
      validateXml: (xmlText: string) => true | { err: { code: string; msg: string; line: number; col: number } };
      classifyCandidate: (
        xmlText: string,
      ) =>
        | { kind: "complete"; end: number }
        | { kind: "incomplete"; reason: "unexpected_eof"; error: { line: number; col: number } }
        | { kind: "indeterminate"; error: { line: number; col: number } };
      offsetFromLineColumn: (source: string, line: number, column: number) => number;
    },
  ) {}

  inspectFenceTail(suffix: string, allowPrefix: boolean): AgentXmlFenceTailStatus {
    const offset = this.options.firstNonWhitespaceOffset(suffix);
    const candidate = suffix.slice(offset);
    return offset >= suffix.length
      ? {
          kind: "accepted",
          partial: false,
        }
      : this.classifyFenceTailCandidate(candidate, offset, allowPrefix);
  }

  classifyTail(
    suffix: string,
    options: {
      fenced: boolean;
      allowFencePrefix: boolean;
    },
  ): AgentXmlTailClassification {
    return this.options.readLeadingContent(suffix) === undefined
      ? {
          kind: AgentXmlTailKinds.Empty,
        }
      : options.fenced
        ? this.classifyFencedTail(suffix, options.allowFencePrefix)
        : this.classifyXmlTail(suffix);
  }

  isIncompleteValidation(error: { code: string; msg: string }): boolean {
    return isIncompleteXmlValidationMessage(error);
  }

  private classifyFenceTailCandidate(
    candidate: string,
    offset: number,
    allowPrefix: boolean,
  ): AgentXmlFenceTailStatus {
    const inspection = this.fenceScanner.inspectClosing(candidate, allowPrefix);

    return matchByKind(inspection, {
      none: () => ({
        kind: "none",
      }),
      prefix: () => ({
        kind: "accepted",
        partial: true,
      }),
      closed: () => ({
        kind: "accepted",
        partial: false,
      }),
      trailing_after_fence: (entry) => ({
        kind: "trailing_after_fence",
        offset: offset + entry.offset,
      }),
    });
  }

  private classifyFencedTail(
    suffix: string,
    allowFencePrefix: boolean,
  ): AgentXmlTailClassification {
    const fenceTail = this.inspectFenceTail(suffix, allowFencePrefix);
    return matchByKind(fenceTail, {
      accepted: (entry) => ({
        kind: entry.partial ? AgentXmlTailKinds.ClosingFencePrefix : AgentXmlTailKinds.ClosingFence,
      }),
      trailing_after_fence: (entry) => ({
        kind: AgentXmlTailKinds.TrailingText,
        offset: entry.offset,
      }),
      none: () => this.classifyXmlTail(suffix),
    });
  }

  private classifyXmlTail(suffix: string): AgentXmlTailClassification {
    const offset = this.options.firstNonWhitespaceOffset(suffix);
    const trimmed = suffix.slice(offset);
    const leadingTag = this.scanner.readLeadingTag(trimmed);

    return leadingTag === undefined
      ? {
          kind: AgentXmlTailKinds.TrailingText,
          offset,
        }
      : this.classifyXmlTailFromMarkup(trimmed, offset);
  }

  private classifyXmlTailFromMarkup(
    trimmed: string,
    offset: number,
  ): AgentXmlTailClassification {
    const leadingTag = this.scanner.readLeadingTag(trimmed);
    return leadingTag?.kind === "close"
      ? {
          kind: AgentXmlTailKinds.OrphanClosingTag,
          offset,
          tagName: leadingTag.name,
        }
      : this.options.findFirstCompleteBoundary(trimmed) !== undefined
        ? {
            kind: AgentXmlTailKinds.ExtraRoot,
            offset,
          }
        : this.classifyXmlTailFromValidation(trimmed, offset);
  }

  private classifyXmlTailFromValidation(
    trimmed: string,
    offset: number,
  ): AgentXmlTailClassification {
    const trailingError = this.classifyTrailingValidationError(trimmed);
    if (trailingError) {
      return {
        kind: AgentXmlTailKinds.OrphanClosingTag,
        offset: offset + trailingError.offset,
        tagName: trailingError.tagName,
      };
    }

    const classification = this.options.classifyCandidate(trimmed);
    return classification.kind === "incomplete"
      ? {
          kind: AgentXmlTailKinds.IncompleteXml,
          offset,
          reason: classification.reason,
        }
      : {
          kind: AgentXmlTailKinds.TrailingText,
          offset,
        };
  }

  private classifyTrailingValidationError(text: string): {
    offset: number;
    tagName?: string;
  } | undefined {
    const validation = this.options.validateXml(text);
    if (validation === true) {
      return undefined;
    }

    const kind = classifyXmlValidationMessage(validation.err);
    if (kind !== "orphan_closing_tag") {
      return undefined;
    }

    const tagOffset = this.options.offsetFromLineColumn(
      text,
      validation.err.line,
      validation.err.col,
    );
    return {
      offset: tagOffset,
      tagName: this.scanner.readTagAt(text, tagOffset)?.name,
    };
  }

}
