import type { AgentSourceDiagnostic } from "../AgentSourceDiagnostic.js";
import { AgentSourceDiagnosticBuilder } from "../AgentSourceDiagnostic.js";
import { AgentXmlParseError } from "../Xml/AgentXmlParser.js";
import {
  AgentDecisionXmlEnvelopeAnalyzer,
  type AgentDecisionXmlEnvelopeAnalyzerOptions,
} from "./AgentDecisionXmlEnvelopeAnalyzer.js";
import {
  AgentXmlErrorCodes,
  AgentXmlTailKinds,
  type AgentXmlErrorCode,
} from "../Xml/AgentXmlStatus.js";

export interface SanitizedDecisionXml {
  xml: string;
  raw: string;
  changed: boolean;
}

export interface AgentDecisionXmlSanitizeOptions {
  acceptRoot?: (rootName: string) => boolean;
}

export class AgentDecisionXmlSanitizer {
  private readonly analyzer: AgentDecisionXmlEnvelopeAnalyzer;

  constructor(options: AgentDecisionXmlEnvelopeAnalyzerOptions = {}) {
    this.analyzer = new AgentDecisionXmlEnvelopeAnalyzer(options);
  }

  sanitize(rawText: string, options: AgentDecisionXmlSanitizeOptions = {}): SanitizedDecisionXml {
    const prepared = this.analyzer.prepareDocument(rawText);
    const trimmed = prepared.body.trim();

    if (trimmed.length === 0) {
      return {
        xml: "",
        raw: prepared.raw,
        changed: prepared.raw !== trimmed,
      };
    }

    const firstContentOffset = this.analyzer.firstNonWhitespaceOffset(trimmed);
    if (firstContentOffset >= trimmed.length) {
      return {
        xml: "",
        raw: prepared.raw,
        changed: prepared.raw !== trimmed,
      };
    }

    const leadingCandidate = trimmed.slice(firstContentOffset);
    const leadingTag = this.analyzer.readLeadingTag(leadingCandidate);
    const candidate = this.selectCandidate({
      trimmed,
      leadingCandidate,
      firstContentOffset,
      leadingTag,
      acceptRoot: options.acceptRoot,
    });

    if (!candidate) {
      throw this.buildError({
        source: trimmed,
        message: "XML 根标签前存在多余文本。",
        code: AgentXmlErrorCodes.XmlEnvelopePrefixText,
        offset: 0,
        suggestion: "删除 XML 根标签前的解释文本、标题或 Markdown。",
      });
    }

    const xmlCandidate = candidate.xmlText;
    const boundary = this.analyzer.findFirstCompleteBoundary(xmlCandidate);

    if (boundary === undefined) {
      const classification = this.analyzer.classifyCandidate(xmlCandidate);

      if (classification.kind === "incomplete") {
        throw this.buildError({
          source: xmlCandidate,
          message: "XML 根标签没有完整闭合。",
          code: AgentXmlErrorCodes.IncompleteXmlEnvelope,
          offset: this.analyzer.offsetFromLineColumn(
            xmlCandidate,
            classification.error.line,
            classification.error.col,
          ),
          suggestion: "输出一个完整闭合的 XML 根节点，不要在标签未闭合时结束输出。",
          details: {
            reason: classification.reason,
            validation: classification.error,
          },
        });
      }

      if (classification.kind === "indeterminate") {
        throw this.buildError({
          source: xmlCandidate,
          message: "模型输出中没有可识别的 XML 根标签。",
          code: AgentXmlErrorCodes.InvalidXmlEnvelope,
          offset: 0,
          suggestion: "只输出一个 XML 决策根标签。",
          details: {
            validation: classification.error,
          },
        });
      }

      throw this.buildError({
        source: xmlCandidate,
        message: "模型输出中没有可识别的 XML 根标签。",
        code: AgentXmlErrorCodes.InvalidXmlEnvelope,
        offset: 0,
        suggestion: "只输出一个 XML 决策根标签。",
      });
    }

    const xml = xmlCandidate.slice(0, boundary).trim();
    const suffix = xmlCandidate.slice(boundary);
    const tail = this.analyzer.classifyDocumentTail(suffix, prepared.fenced);

    if (tail.kind === AgentXmlTailKinds.ExtraRoot) {
      throw this.buildError({
        source: xmlCandidate,
        message: "XML 根标签后存在额外根节点。",
        code: AgentXmlErrorCodes.XmlEnvelopeExtraRoot,
        offset: boundary + tail.offset,
        suggestion: "只保留一个 XML 根标签，不要拼接第二个 XML 根节点。",
      });
    }

    if (tail.kind === AgentXmlTailKinds.OrphanClosingTag) {
      const tagName = tail.tagName?.trim();
      throw this.buildError({
        source: xmlCandidate,
        message: tagName
          ? `XML 根标签后出现孤立的结束标签：${tagName}。`
          : "XML 根标签后出现孤立的结束标签。",
        code: AgentXmlErrorCodes.XmlEnvelopeOrphanClosingTag,
        offset: boundary + tail.offset,
        suggestion: tagName
          ? `补齐对应的开始标签 <${tagName}>，或删除多余的 </${tagName}>；整个输出必须只有一个完整根节点。`
          : "补齐对应的开始标签，或删除多余的结束标签；整个输出必须只有一个完整根节点。",
      });
    }

    if (tail.kind === AgentXmlTailKinds.IncompleteXml) {
      throw this.buildError({
        source: xmlCandidate,
        message: "XML 根标签后存在不完整的附加 XML 输出。",
        code: AgentXmlErrorCodes.IncompleteXmlEnvelope,
        offset: boundary + tail.offset,
        suggestion: "删除附加的残缺 XML，或输出一个完整闭合的单一 XML 根节点。",
        details: {
          reason: tail.reason,
        },
      });
    }

    if (
      tail.kind === AgentXmlTailKinds.Empty
      || tail.kind === AgentXmlTailKinds.ClosingFence
      || tail.kind === AgentXmlTailKinds.ClosingFencePrefix
    ) {
      return {
        xml,
        raw: prepared.raw,
        changed: xml !== prepared.raw.trim(),
      };
    }

    if (tail.kind === AgentXmlTailKinds.TrailingText) {
      throw this.buildError({
        source: xmlCandidate,
        message: "XML 根标签后存在多余文本。",
        code: AgentXmlErrorCodes.XmlEnvelopeSuffixText,
        offset: boundary + tail.offset,
        suggestion: "删除 XML 根标签后的说明文字，只保留 XML。",
      });
    }

    throw this.buildError({
      source: xmlCandidate,
      message: "XML 根标签后存在无法识别的附加内容。",
      code: AgentXmlErrorCodes.InvalidXmlEnvelope,
      offset: boundary,
      suggestion: "只输出一个完整 XML 根节点。",
    });
  }

  private buildError(options: {
    source: string;
    message: string;
    code: AgentXmlErrorCode;
    offset: number;
    suggestion: string;
    details?: Record<string, unknown>;
  }): AgentXmlParseError {
    const builder = new AgentSourceDiagnosticBuilder(options.source);
    const diagnostics: AgentSourceDiagnostic[] = [
      builder.fromPosition(options.message, options.offset, {
        pointer: "/",
        suggestion: options.suggestion,
      }),
    ];

    return new AgentXmlParseError(
      options.message,
      diagnostics,
      AgentXmlErrorCodes.InvalidXmlSyntax,
      {
        code: options.code,
        suggestion: options.suggestion,
        ...options.details,
      },
    );
  }

  private selectCandidate(options: {
    trimmed: string;
    leadingCandidate: string;
    firstContentOffset: number;
    leadingTag: ReturnType<AgentDecisionXmlEnvelopeAnalyzer["readLeadingTag"]>;
    acceptRoot?: (rootName: string) => boolean;
  }) {
    if (options.leadingTag === undefined) {
      return this.analyzer.findFirstCompleteCandidate(options.trimmed, {
        acceptRoot: options.acceptRoot,
      });
    }

    const completeLeadingCandidate = this.analyzer.findFirstCompleteCandidate(
      options.leadingCandidate,
      {
        acceptRoot: options.acceptRoot,
      },
    );
    if (completeLeadingCandidate?.offset === 0) {
      return {
        ...completeLeadingCandidate,
        prefix: options.trimmed.slice(0, options.firstContentOffset),
        offset: options.firstContentOffset,
      };
    }

    const leadingCandidate = {
      xmlText: options.leadingCandidate,
      prefix: options.trimmed.slice(0, options.firstContentOffset),
      offset: options.firstContentOffset,
      rootName: options.leadingTag.name,
    };

    if (!options.acceptRoot || options.acceptRoot(options.leadingTag.name)) {
      return leadingCandidate;
    }

    return this.analyzer.findFirstCompleteCandidate(options.trimmed, {
      acceptRoot: options.acceptRoot,
    }) ?? leadingCandidate;
  }
}
