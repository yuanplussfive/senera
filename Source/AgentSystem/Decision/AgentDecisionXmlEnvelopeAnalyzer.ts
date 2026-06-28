import { XMLValidator, type ValidationError } from "fast-xml-parser";
import type { AgentXmlProtocolPolicy } from "../Xml/AgentXmlPolicy.js";
import { AgentXmlLexicalScanner } from "../Xml/AgentXmlLexicalScanner.js";
import { AgentXmlEnvelopeBoundaryScanner } from "../Xml/AgentXmlEnvelopeBoundaryScanner.js";
import { AgentXmlEnvelopeClassifier } from "../Xml/AgentXmlEnvelopeClassifier.js";
import { AgentMarkdownFenceScanner } from "../Xml/AgentMarkdownFenceScanner.js";
import { AgentTextLocator } from "../AgentTextLocator.js";
import { AgentXmlCandidateOffsetScanner } from "../Xml/AgentXmlCandidateOffsetScanner.js";
import {
  AgentXmlEnvelopeKinds,
} from "../Xml/AgentXmlStatus.js";
import type { AgentXmlCandidateNormalizer } from "../Xml/AgentToolCallsXmlNormalizer.js";
import { AgentDecisionXmlFenceReader } from "./AgentDecisionXmlFenceReader.js";
import type {
  AgentDecisionXmlCandidate,
  AgentDecisionXmlEnvelopeAnalyzerOptions,
  DecisionXmlCandidateStatus,
  DecisionXmlTailStatus,
  PreparedDecisionXmlDocument,
  StreamingDecisionXmlEnvelope,
} from "./AgentDecisionXmlEnvelopeTypes.js";

export type {
  AgentDecisionXmlCandidate,
  AgentDecisionXmlEnvelopeAnalyzerOptions,
  DecisionXmlCandidateStatus,
  DecisionXmlTailStatus,
  PreparedDecisionXmlDocument,
  StreamingDecisionXmlEnvelope,
} from "./AgentDecisionXmlEnvelopeTypes.js";

export class AgentDecisionXmlEnvelopeAnalyzer {
  private readonly scanner = new AgentXmlLexicalScanner();
  private readonly boundaryScanner = new AgentXmlEnvelopeBoundaryScanner();
  private readonly candidateOffsetScanner = new AgentXmlCandidateOffsetScanner();
  private readonly locator = new AgentTextLocator();
  private readonly fenceScanner = new AgentMarkdownFenceScanner(this.locator);
  private readonly fenceReader: AgentDecisionXmlFenceReader;
  private readonly classifier: AgentXmlEnvelopeClassifier;
  private readonly xmlFenceLanguages: Set<string>;
  private readonly policy?: AgentXmlProtocolPolicy;
  private readonly acceptRoot?: (rootName: string) => boolean;
  private readonly allowEmbeddedCandidates: boolean;
  private readonly allowFencedEnvelope: boolean;
  private readonly candidateNormalizer?: AgentXmlCandidateNormalizer;

  constructor(options: AgentDecisionXmlEnvelopeAnalyzerOptions = {}) {
    this.policy = options.policy;
    this.acceptRoot = options.acceptRoot;
    this.allowEmbeddedCandidates = options.allowEmbeddedCandidates ?? true;
    this.allowFencedEnvelope = options.allowFencedEnvelope ?? true;
    this.candidateNormalizer = options.candidateNormalizer;
    this.xmlFenceLanguages = new Set(
      options.policy
        ? [...options.policy.xmlFenceLanguages]
        : ["", "xml", ...(options.xmlFenceLanguages ?? [])]
          .map((item) => item.trim().toLowerCase()),
    );
    this.fenceReader = new AgentDecisionXmlFenceReader(
      this.locator,
      this.fenceScanner,
      (info) => this.isAllowedFenceLanguage(info),
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
    return this.fenceReader.prepareDocument(rawText);
  }

  inspectStreamingEnvelope(rawText: string): StreamingDecisionXmlEnvelope {
    const raw = this.stripBom(rawText);
    const leading = this.readLeadingContent(raw);
    const opening = leading
      ? this.fenceScanner.readOpening(leading, (info) => this.isAllowedFenceLanguage(info))
      : undefined;

    return leading === undefined
      ? {
          kind: AgentXmlEnvelopeKinds.Collecting,
          raw,
          body: "",
          fenced: false,
        }
      : opening?.kind !== "absent" && !this.allowFencedEnvelope
        ? {
            kind: AgentXmlEnvelopeKinds.Collecting,
            raw,
            body: raw,
            fenced: opening?.kind === "open",
          }
      : opening?.kind !== "absent"
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
      includeFenced?: boolean;
    } = {},
  ): AgentDecisionXmlCandidate | undefined {
    for (const offset of this.findCandidateStartOffsets(text, {
      includeFenced: options.includeFenced ?? true,
    })) {
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

  *findCandidateStartOffsets(
    text: string,
    options: {
      includeFenced?: boolean;
    } = {},
  ): Iterable<number> {
    yield* this.candidateOffsetScanner.findOffsets(text, options);
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

  private readLeadingContent(text: string): string | undefined {
    return this.locator.readLeadingContent(text);
  }

  private isAllowedFenceLanguage(info: string): boolean {
    const language = info.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    return this.xmlFenceLanguages.has(language);
  }
}
