import { AgentDecisionXmlEnvelopeAnalyzer } from "./AgentDecisionXmlEnvelopeAnalyzer.js";
import type { AgentXmlProtocolPolicy } from "../Xml/AgentXmlPolicy.js";
import type { AgentXmlCandidateNormalizer } from "../Xml/AgentToolCallsXmlNormalizer.js";
import { AgentXmlLexicalScanner } from "../Xml/AgentXmlLexicalScanner.js";
import { matchByKind } from "../AgentMatch.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";

export type AgentDecisionOutputShape =
  | {
      kind: "plain_text";
      text: string;
    }
  | {
      kind: "pure_tool_envelope";
      text: string;
      xml: string;
    }
  | {
      kind: "mixed_tool_envelope";
      text: string;
      xml: string;
      prefix: string;
      suffix: string;
      offset: number;
    }
  | {
      kind: "tool_envelope_fragment";
      text: string;
    };

export type AgentDecisionOutputResolution =
  | {
      kind: "tool_calls";
      text: string;
      xml: string;
      recovered: boolean;
    }
  | {
      kind: "final_text";
      text: string;
    }
  | {
      kind: "action_mismatch";
      text: string;
      expected: AgentDecisionOutputContract;
      actual: AgentDecisionOutputShape["kind"];
    };

export type AgentDecisionOutputContract =
  | "tool_call_xml"
  | "final_text"
  | "open";

export interface AgentDecisionOutputResolverOptions {
  policy: AgentXmlProtocolPolicy;
  toolCallsRoot: string;
  acceptRoot: (rootName: string) => boolean;
  candidateNormalizer?: AgentXmlCandidateNormalizer;
}

export class AgentDecisionOutputResolver {
  private readonly analyzer: AgentDecisionXmlEnvelopeAnalyzer;
  private readonly scanner = new AgentXmlLexicalScanner();

  constructor(private readonly options: AgentDecisionOutputResolverOptions) {
    this.analyzer = new AgentDecisionXmlEnvelopeAnalyzer({
      policy: options.policy,
      acceptRoot: options.acceptRoot,
      allowEmbeddedCandidates: true,
      allowFencedEnvelope: false,
      candidateNormalizer: options.candidateNormalizer,
    });
  }

  resolve(options: {
    text: string;
    rootCommand?: AgentRootCommand;
    pureToolXml?: string;
  }): AgentDecisionOutputResolution {
    const shape = this.classify(options.text, options.pureToolXml);
    const contract = this.contractFor(options.rootCommand);

    return ({
      open: () => this.resolveOpen(shape),
      tool_call_xml: () => this.resolveToolCallContract(shape),
      final_text: () => this.resolveFinalTextContract(shape),
    } satisfies Record<AgentDecisionOutputContract, () => AgentDecisionOutputResolution>)[contract]();
  }

  hasToolEnvelopeStart(text: string): boolean {
    const candidate = text.trimStart();
    return this.startsWithRootName(candidate, this.options.toolCallsRoot);
  }

  private classify(text: string, pureToolXml?: string): AgentDecisionOutputShape {
    if (pureToolXml) {
      return {
        kind: "pure_tool_envelope",
        text,
        xml: pureToolXml,
      };
    }

    const candidate = this.analyzer.findFirstCompleteCandidate(text, {
      acceptRoot: this.options.acceptRoot,
      includeFenced: false,
    });
    const embedded = candidate ? this.readEmbeddedToolEnvelope(text, candidate) : undefined;
    if (embedded) {
      return embedded;
    }

    return this.hasToolEnvelopeStart(text)
      ? {
          kind: "tool_envelope_fragment",
          text,
        }
      : {
          kind: "plain_text",
          text,
        };
  }

  private readEmbeddedToolEnvelope(
    text: string,
    candidate: {
      xmlText: string;
      prefix: string;
      offset: number;
    },
  ): AgentDecisionOutputShape | undefined {
    const boundary = this.analyzer.findFirstCompleteBoundary(candidate.xmlText);
    if (boundary === undefined) {
      return undefined;
    }

    const xml = candidate.xmlText.slice(0, boundary).trim();
    const suffix = candidate.xmlText.slice(boundary);
    const cleanPrefix = candidate.prefix.trim();
    const cleanSuffix = suffix.trim();

    return cleanPrefix.length === 0 && cleanSuffix.length === 0
      ? {
          kind: "pure_tool_envelope",
          text,
          xml,
        }
      : {
          kind: "mixed_tool_envelope",
          text,
          xml,
          prefix: candidate.prefix,
          suffix,
          offset: candidate.offset,
        };
  }

  private resolveOpen(shape: AgentDecisionOutputShape): AgentDecisionOutputResolution {
    return matchByKind(shape, {
      pure_tool_envelope: (entry) => this.toolCalls(entry, false),
      mixed_tool_envelope: (entry) => this.finalText(entry),
      tool_envelope_fragment: (entry) => this.mismatch(entry, "tool_call_xml"),
      plain_text: (entry) => this.finalText(entry),
    });
  }

  private resolveToolCallContract(shape: AgentDecisionOutputShape): AgentDecisionOutputResolution {
    return matchByKind(shape, {
      pure_tool_envelope: (entry) => this.toolCalls(entry, false),
      mixed_tool_envelope: (entry) => this.mismatch(entry, "tool_call_xml"),
      tool_envelope_fragment: (entry) => this.mismatch(entry, "tool_call_xml"),
      plain_text: (entry) => this.mismatch(entry, "tool_call_xml"),
    });
  }

  private resolveFinalTextContract(shape: AgentDecisionOutputShape): AgentDecisionOutputResolution {
    return matchByKind(shape, {
      pure_tool_envelope: (entry) => this.mismatch(entry, "final_text"),
      mixed_tool_envelope: (entry) => this.finalText(entry),
      tool_envelope_fragment: (entry) => this.finalText(entry),
      plain_text: (entry) => this.finalText(entry),
    });
  }

  private toolCalls(
    shape: Extract<AgentDecisionOutputShape, { kind: "pure_tool_envelope" | "mixed_tool_envelope" }>,
    recovered: boolean,
  ): AgentDecisionOutputResolution {
    return {
      kind: "tool_calls",
      text: shape.text,
      xml: shape.xml,
      recovered,
    };
  }

  private finalText(shape: AgentDecisionOutputShape): AgentDecisionOutputResolution {
    return {
      kind: "final_text",
      text: shape.text,
    };
  }

  private mismatch(
    shape: AgentDecisionOutputShape,
    expected: AgentDecisionOutputContract,
  ): AgentDecisionOutputResolution {
    return {
      kind: "action_mismatch",
      text: shape.text,
      expected,
      actual: shape.kind,
    };
  }

  private contractFor(rootCommand: AgentRootCommand | undefined): AgentDecisionOutputContract {
    if (!rootCommand) {
      return "open";
    }

    return rootCommand.outputMode;
  }

  private startsWithRootName(text: string, rootName: string): boolean {
    return this.scanner.readLeadingTag(text)?.name.toLowerCase() === rootName.toLowerCase();
  }
}
