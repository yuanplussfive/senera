import {
  AgentEventKinds,
  createEventDetailId,
  summarizeXmlDocument,
  type AgentDomainEvent,
} from "../Events/AgentEvent.js";
import type { SanitizedDecisionXml } from "../Decision/AgentDecisionXmlSanitizer.js";
import type { AgentDecision } from "../Types/ToolRuntimeTypes.js";
import type { AgentRetryInstruction } from "../Retry/AgentRetryableError.js";

export class AgentLoopDecisionEventFactory {
  sanitizedDecisionXml(
    requestId: string,
    step: number,
    sanitized: SanitizedDecisionXml,
  ): AgentDomainEvent[] {
    if (!sanitized.changed) {
      return [];
    }

    const detailId = createEventDetailId(
      requestId,
      step,
      AgentEventKinds.DecisionXmlDetail,
      "sanitized",
    );
    const summary = summarizeXmlDocument(sanitized.xml, {
      sanitized: true,
      detailId,
    });

    return [
      {
        kind: summary.kind,
        context: { requestId, step },
        data: summary.data,
      },
      {
        kind: AgentEventKinds.DecisionXmlDetail,
        context: { requestId, step },
        data: {
          detailId,
          rawXml: sanitized.raw,
          xml: sanitized.xml,
          sanitized: true,
        },
      },
    ];
  }

  parsedDecision(requestId: string, step: number, decision: AgentDecision): AgentDomainEvent[] {
    const detailId = createEventDetailId(
      requestId,
      step,
      AgentEventKinds.DecisionParsedDetail,
      decision.kind.toLowerCase(),
    );

    return [
      {
        kind: AgentEventKinds.DecisionParsed,
        context: { requestId, step },
        data: {
          root: decision.root,
          decisionKind: decision.kind,
          detailId,
        },
      },
      {
        kind: AgentEventKinds.DecisionParsedDetail,
        context: { requestId, step },
        data: {
          detailId,
          root: decision.root,
          decisionKind: decision.kind,
          payload: decision.payload,
        },
      },
    ];
  }

  retryPlanned(
    requestId: string,
    step: number,
    attempt: number,
    instruction: AgentRetryInstruction,
  ): AgentDomainEvent[] {
    const detailId = createEventDetailId(
      requestId,
      step,
      AgentEventKinds.RetryDetail,
      String(attempt),
    );

    return [
      {
        kind: AgentEventKinds.RetryPlanned,
        context: { requestId, step },
        data: {
          attempt,
          code: instruction.code,
          message: instruction.message,
          retryable: instruction.retryable,
          detailId,
        },
      },
      {
        kind: AgentEventKinds.RetryDetail,
        context: { requestId, step },
        data: {
          detailId,
          instruction,
        },
      },
    ];
  }
}
