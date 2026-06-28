import type { ValidationError } from "fast-xml-parser";
import {
  AgentXmlEnvelopeKinds,
  AgentXmlErrorCodes,
} from "../Xml/AgentXmlStatus.js";
import type { AgentXmlProtocolPolicy } from "../Xml/AgentXmlPolicy.js";
import type { AgentXmlCandidateNormalizer } from "../Xml/AgentToolCallsXmlNormalizer.js";

export interface AgentDecisionXmlEnvelopeAnalyzerOptions {
  xmlFenceLanguages?: string[];
  policy?: AgentXmlProtocolPolicy;
  acceptRoot?: (rootName: string) => boolean;
  allowEmbeddedCandidates?: boolean;
  allowFencedEnvelope?: boolean;
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

