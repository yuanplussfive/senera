import { AgentDecisionXmlEnvelopeAnalyzer } from "./AgentDecisionXmlEnvelopeAnalyzer.js";
import type { AgentXmlProtocolPolicy } from "./AgentXmlPolicy.js";
import type { AgentXmlCandidateNormalizer } from "./AgentToolCallsXmlNormalizer.js";
import {
  AgentXmlStreamStates,
  tailKindToErrorCode,
} from "./AgentXmlStatus.js";

export type AgentDecisionXmlStreamSnapshot =
  | {
      state: typeof AgentXmlStreamStates.Collecting;
      rawText: string;
      candidateXml: string;
      fenced: boolean;
    }
  | {
      state: typeof AgentXmlStreamStates.RootClosed;
      rawText: string;
      candidateXml: string;
      fenced: boolean;
    }
  | {
      state: typeof AgentXmlStreamStates.Invalid;
      rawText: string;
      candidateXml: string;
      fenced: boolean;
      reasonCode: string;
    };

type StreamState =
  | {
      phase: "collecting";
      rawText: string;
      candidateXml: string;
      fenced: boolean;
    }
  | {
      phase: "closed";
      rawText: string;
      candidateXml: string;
      fenced: boolean;
    }
  | {
      phase: "invalid";
      rawText: string;
      candidateXml: string;
      fenced: boolean;
      reasonCode: string;
    };

export interface AgentDecisionXmlStreamAssemblerOptions {
  xmlFenceLanguages?: string[];
  policy?: AgentXmlProtocolPolicy;
  acceptRoot?: (rootName: string) => boolean;
  allowEmbeddedCandidates?: boolean;
  candidateNormalizer?: AgentXmlCandidateNormalizer;
}

export class AgentDecisionXmlStreamAssembler {
  private readonly analyzer: AgentDecisionXmlEnvelopeAnalyzer;

  private state: StreamState = {
    phase: "collecting",
    rawText: "",
    candidateXml: "",
    fenced: false,
  };

  constructor(options: AgentDecisionXmlStreamAssemblerOptions = {}) {
    this.analyzer = new AgentDecisionXmlEnvelopeAnalyzer({
      xmlFenceLanguages: options.xmlFenceLanguages,
      policy: options.policy,
      acceptRoot: options.acceptRoot,
      allowEmbeddedCandidates: options.allowEmbeddedCandidates,
      candidateNormalizer: options.candidateNormalizer,
    });
  }

  push(delta: string): AgentDecisionXmlStreamSnapshot {
    this.state = this.advance(`${this.state.rawText}${delta}`);
    return this.snapshot();
  }

  current(): AgentDecisionXmlStreamSnapshot {
    return this.snapshot();
  }

  private snapshot(): AgentDecisionXmlStreamSnapshot {
    return this.state.phase === "invalid"
      ? {
          state: AgentXmlStreamStates.Invalid,
          rawText: this.state.rawText,
          candidateXml: this.state.candidateXml,
          fenced: this.state.fenced,
          reasonCode: this.state.reasonCode,
        }
      : this.state.phase === "closed"
        ? {
            state: AgentXmlStreamStates.RootClosed,
            rawText: this.state.rawText,
            candidateXml: this.state.candidateXml,
            fenced: this.state.fenced,
          }
        : {
            state: AgentXmlStreamStates.Collecting,
            rawText: this.state.rawText,
            candidateXml: this.state.candidateXml,
            fenced: this.state.fenced,
          };
  }

  private advance(rawText: string): StreamState {
    const envelope = this.analyzer.inspectStreamingEnvelope(rawText);

    if (envelope.kind === "invalid") {
      return {
        phase: "invalid",
        rawText,
        candidateXml: envelope.body,
        fenced: envelope.fenced,
        reasonCode: envelope.code,
      };
    }

    if (envelope.kind === "collecting") {
      return {
        phase: "collecting",
        rawText,
        candidateXml: envelope.body,
        fenced: envelope.fenced,
      };
    }

    const body = envelope.body.trimStart();
    const boundary = this.analyzer.findFirstCompleteBoundary(body);

    if (boundary === undefined) {
      return {
        phase: "collecting",
        rawText,
        candidateXml: body,
        fenced: envelope.fenced,
      };
    }

    const xml = body.slice(0, boundary);
    const tail = this.analyzer.classifyStreamingTail(body.slice(boundary), envelope.fenced);

    const reasonCode = tailKindToErrorCode(tail.kind);
    if (reasonCode) {
      return {
        phase: "invalid",
        rawText,
        candidateXml: body,
        fenced: envelope.fenced,
        reasonCode,
      };
    }

    return ({
      empty: (): StreamState => ({
        phase: "closed",
        rawText,
        candidateXml: xml,
        fenced: envelope.fenced,
      }),
      closing_fence: (): StreamState => ({
        phase: "closed",
        rawText,
        candidateXml: xml,
        fenced: envelope.fenced,
      }),
      closing_fence_prefix: (): StreamState => ({
        phase: "collecting",
        rawText,
        candidateXml: xml,
        fenced: envelope.fenced,
      }),
      orphan_closing_tag: (): StreamState => this.state,
      extra_root: (): StreamState => this.state,
      incomplete_xml: (): StreamState => this.state,
      trailing_text: (): StreamState => this.state,
    })[tail.kind]();
  }
}
