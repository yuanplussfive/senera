import MarkdownIt from "markdown-it";
import { XMLValidator, type ValidationError } from "fast-xml-parser";
import type { AgentXmlProtocolPolicy } from "./AgentXmlPolicy.js";
import { AgentXmlLexicalScanner } from "./AgentXmlLexicalScanner.js";
import { AgentXmlEnvelopeBoundaryScanner } from "./AgentXmlEnvelopeBoundaryScanner.js";
import { AgentXmlEnvelopeClassifier } from "./AgentXmlEnvelopeClassifier.js";
import { AgentMarkdownFenceScanner } from "./AgentMarkdownFenceScanner.js";
import { AgentTextLocator } from "./AgentTextLocator.js";
import {
  AgentXmlEnvelopeKinds,
  AgentXmlErrorCodes,
} from "./AgentXmlStatus.js";
import type { AgentXmlCandidateNormalizer } from "./AgentToolCallsXmlNormalizer.js";

export interface AgentDecisionXmlEnvelopeAnalyzerOptions {
  xmlFenceLanguages?: string[];
  policy?: AgentXmlProtocolPolicy;
  acceptRoot?: (rootName: string) => boolean;
  allowEmbeddedCandidates?: boolean;
  candidateNormalizer?: AgentXmlCandidateNormalizer;
}

export interface PreparedDecisionXmlDocument {
  raw: string;
  body: string;
  fenced: boolean;
}

export interface AgentDecisionXmlCandidate {
  xmlText: string;
  prefix: string;
  offset: number;
  rootName: string;
}

export type StreamingDecisionXmlEnvelope =
  | {
      kind: typeof AgentXmlEnvelopeKinds.Collecting;
      raw: string;
      body: string;
      fenced: boolean;
    }
  | {
      kind: typeof AgentXmlEnvelopeKinds.Ready;
      raw: string;
      body: string;
      fenced: boolean;
    }
  | {
      kind: typeof AgentXmlEnvelopeKinds.Invalid;
      raw: string;
      body: string;
      fenced: boolean;
      code: typeof AgentXmlErrorCodes.XmlEnvelopePrefixText;
    };

export type DecisionXmlCandidateStatus =
  | {
      kind: "complete";
      end: number;
    }
  | {
      kind: "incomplete";
      reason: "unexpected_eof";
      error: ValidationError["err"];
    }
  | {
      kind: "indeterminate";
      error: ValidationError["err"];
    };

export type DecisionXmlTailStatus =
  | {
      kind: "empty";
    }
  | {
      kind: "closing_fence";
    }
  | {
      kind: "closing_fence_prefix";
    }
  | {
      kind: "trailing_text";
      offset: number;
    }
  | {
      kind: "orphan_closing_tag";
      offset: number;
      tagName?: string;
    }
  | {
      kind: "extra_root";
      offset: number;
    }
  | {
      kind: "incomplete_xml";
      offset: number;
      reason: "unexpected_eof";
    };

export class AgentDecisionXmlEnvelopeAnalyzer {
  private readonly markdown = new MarkdownIt({
    html: false,
    linkify: false,
    typographer: false,
  });

  private readonly scanner = new AgentXmlLexicalScanner();
  private readonly boundaryScanner = new AgentXmlEnvelopeBoundaryScanner();
  private readonly locator = new AgentTextLocator();
  private readonly fenceScanner = new AgentMarkdownFenceScanner(this.locator);
  private readonly classifier: AgentXmlEnvelopeClassifier;
  private readonly xmlFenceLanguages: Set<string>;
  private readonly policy?: AgentXmlProtocolPolicy;
  private readonly acceptRoot?: (rootName: string) => boolean;
  private readonly allowEmbeddedCandidates: boolean;
  private readonly candidateNormalizer?: AgentXmlCandidateNormalizer;

  constructor(options: AgentDecisionXmlEnvelopeAnalyzerOptions = {}) {
    this.policy = options.policy;
    this.acceptRoot = options.acceptRoot;
    this.allowEmbeddedCandidates = options.allowEmbeddedCandidates ?? true;
    this.candidateNormalizer = options.candidateNormalizer;
    this.xmlFenceLanguages = new Set(
      options.policy
        ? [...options.policy.xmlFenceLanguages]
        : ["", "xml", ...(options.xmlFenceLanguages ?? [])]
          .map((item) => item.trim().toLowerCase()),
    );
    this.classifier = new AgentXmlEnvelopeClassifier(this.scanner, this.fenceScanner, {
      readLeadingContent: (text) => this.readLeadingContent(text),
      firstNonWhitespaceOffset: (text) => this.firstNonWhitespaceOffset(text),
      findFirstCompleteBoundary: (xmlText, fromOffset) =>
        this.findFirstCompleteBoundary(xmlText, fromOffset),
      validateXml: (xmlText) => this.validateXml(xmlText),
      classifyCandidate: (xmlText) => this.classifyCandidate(xmlText),
      offsetFromLineColumn: (source, line, column) => this.offsetFromLineColumn(source, line, column),
    });
  }

  prepareDocument(rawText: string): PreparedDecisionXmlDocument {
    const raw = this.stripBom(rawText);
    const standaloneFenceBody = this.unwrapStandaloneFence(raw);

    return standaloneFenceBody !== undefined
      ? {
          raw,
          body: standaloneFenceBody,
          fenced: true,
        }
      : this.unwrapLeadingFence(raw);
  }

  inspectStreamingEnvelope(rawText: string): StreamingDecisionXmlEnvelope {
    const raw = this.stripBom(rawText);
    const leading = this.readLeadingContent(raw);

    return leading === undefined
      ? {
          kind: AgentXmlEnvelopeKinds.Collecting,
          raw,
          body: "",
          fenced: false,
        }
      : this.fenceScanner.readOpening(leading, (info) => this.isAllowedFenceLanguage(info)).kind !== "absent"
        ? this.inspectFencedStreamingEnvelope(raw, leading)
        : this.classifyStreamingBody(raw, leading, false);
  }

  findFirstCompleteBoundary(xmlText: string, fromOffset = 0): number | undefined {
    return this.boundaryScanner.findFirstCompleteBoundary(xmlText, fromOffset);
  }

  findFirstCompleteCandidate(
    text: string,
    options: {
      acceptRoot?: (rootName: string) => boolean;
    } = {},
  ): AgentDecisionXmlCandidate | undefined {
    for (const offset of this.findCandidateStartOffsets(text)) {
      const candidate = text.slice(offset);
      if (this.scanner.readLeadingTag(candidate) === undefined) {
        continue;
      }

      const scan = this.boundaryScanner.scanFirstCompleteBoundary(candidate);
      if (
        scan.kind === "complete"
        && (!options.acceptRoot || options.acceptRoot(scan.rootName))
      ) {
        return {
          xmlText: this.normalizeCompleteCandidate(candidate, scan.end),
          prefix: text.slice(0, offset),
          offset,
          rootName: scan.rootName,
        };
      }

      const normalized = this.candidateNormalizer?.normalize(candidate);
      if (!normalized?.changed) {
        continue;
      }

      const normalizedScan = this.boundaryScanner.scanFirstCompleteBoundary(normalized.xml);
      if (
        normalizedScan.kind === "complete"
        && (!options.acceptRoot || options.acceptRoot(normalizedScan.rootName))
      ) {
        return {
          xmlText: normalized.xml,
          prefix: text.slice(0, offset),
          offset,
          rootName: normalizedScan.rootName,
        };
      }
    }

    return undefined;
  }

  private normalizeCompleteCandidate(candidate: string, boundary: number): string {
    if (!this.candidateNormalizer) {
      return candidate;
    }

    const rootXml = candidate.slice(0, boundary);
    const suffix = candidate.slice(boundary);
    const normalized = this.candidateNormalizer.normalize(rootXml);
    return normalized.changed ? `${normalized.xml}${suffix}` : candidate;
  }

  classifyCandidate(xmlText: string): DecisionXmlCandidateStatus {
    const validation = XMLValidator.validate(xmlText, {
      allowBooleanAttributes: this.policy?.allowBooleanAttributes ?? false,
    });

    return validation === true
      ? {
          kind: "complete",
          end: xmlText.length,
        }
      : this.classifier.isIncompleteValidation(validation.err)
        ? {
            kind: "incomplete",
            reason: "unexpected_eof",
            error: validation.err,
          }
        : {
            kind: "indeterminate",
            error: validation.err,
          };
  }

  validateXml(xmlText: string): true | ValidationError {
    return XMLValidator.validate(xmlText, {
      allowBooleanAttributes: this.policy?.allowBooleanAttributes ?? false,
    });
  }

  classifyDocumentTail(suffix: string, fenced: boolean): DecisionXmlTailStatus {
    return this.classifier.classifyTail(suffix, {
      fenced,
      allowFencePrefix: true,
    });
  }

  classifyStreamingTail(suffix: string, fenced: boolean): DecisionXmlTailStatus {
    return this.classifier.classifyTail(suffix, {
      fenced,
      allowFencePrefix: true,
    });
  }

  offsetFromLineColumn(source: string, line: number, column: number): number {
    return this.locator.offsetFromLineColumn(source, line, column);
  }

  firstNonWhitespaceOffset(text: string): number {
    return this.locator.firstNonWhitespaceOffset(text);
  }

  private stripBom(text: string): string {
    return this.locator.stripBom(text);
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
    const leading = this.readLeadingContent(raw);
    if (leading === undefined) {
      return {
        raw,
        body: raw,
        fenced: false,
      };
    }

    const opening = this.fenceScanner.readOpening(
      leading,
      (info) => this.isAllowedFenceLanguage(info),
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

  private inspectFencedStreamingEnvelope(
    raw: string,
    leading: string,
  ): StreamingDecisionXmlEnvelope {
    const opening = this.fenceScanner.readOpening(
      leading,
      (info) => this.isAllowedFenceLanguage(info),
    );
    return opening.kind !== "open"
      ? {
          kind: AgentXmlEnvelopeKinds.Collecting,
          raw,
          body: "",
          fenced: true,
        }
      : this.classifyStreamingBody(raw, leading.slice(opening.bodyOffset ?? 0), true);
  }

  readLeadingTag(text: string) {
    return this.scanner.readLeadingTag(text);
  }

  private classifyStreamingBody(
    raw: string,
    body: string,
    fenced: boolean,
  ): StreamingDecisionXmlEnvelope {
    const firstContentOffset = this.firstNonWhitespaceOffset(body);
    const leading = this.scanner.readLeadingTag(body.slice(firstContentOffset));
    if (firstContentOffset >= body.length) {
      return {
        kind: AgentXmlEnvelopeKinds.Collecting,
        raw,
        body,
        fenced,
      };
    }

    if (leading !== undefined && this.isAcceptedStreamingRoot(leading.name)) {
      const candidate = this.findFirstCompleteCandidate(body.slice(firstContentOffset), {
        acceptRoot: this.acceptRoot,
      });
      if (candidate?.offset === 0) {
        return {
          kind: AgentXmlEnvelopeKinds.Ready,
          raw,
          body: candidate.xmlText,
          fenced,
        };
      }

      return {
        kind: AgentXmlEnvelopeKinds.Ready,
        raw,
        body,
        fenced,
      };
    }

    const candidate = this.allowEmbeddedCandidates
      ? this.findFirstCompleteCandidate(body, {
          acceptRoot: this.acceptRoot,
        })
      : undefined;
    return candidate
      ? {
          kind: AgentXmlEnvelopeKinds.Ready,
          raw,
          body: candidate.xmlText,
          fenced,
        }
      : {
          kind: AgentXmlEnvelopeKinds.Collecting,
          raw,
          body,
          fenced,
        };
  }

  private isAcceptedStreamingRoot(rootName: string): boolean {
    return !this.acceptRoot || this.acceptRoot(rootName);
  }

  private *findCandidateStartOffsets(text: string): Iterable<number> {
    const pattern = /</g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      yield match.index;
    }
  }

  private readLeadingContent(text: string): string | undefined {
    return this.locator.readLeadingContent(text);
  }

  private isAllowedFenceLanguage(info: string): boolean {
    const language = info.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    return this.xmlFenceLanguages.has(language);
  }
}
