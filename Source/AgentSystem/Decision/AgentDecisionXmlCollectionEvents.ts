import {
  AgentEventKinds,
  createEventDetailId,
  emitAgentEvent,
  summarizeXmlDocument,
} from "../AgentEvent.js";
import type { AgentExceededTextBudgetSnapshot } from "../AgentTextBudget.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentXmlProtocolPolicy } from "../Xml/AgentXmlPolicy.js";
import {
  extractDecisionStreamingPreview,
  type DecisionStreamingPreviewRule,
} from "./AgentDecisionStreamingPreview.js";
import type { AgentDecisionXmlStreamSnapshot } from "./AgentDecisionXmlStreamAssembler.js";
import type { AgentDecisionXmlCollectRequest } from "./AgentDecisionXmlCollectionTypes.js";

export class AgentDecisionXmlCollectionEvents {
  constructor(
    private readonly policy: AgentXmlProtocolPolicy,
    private readonly previewRules: readonly DecisionStreamingPreviewRule[],
  ) {}

  async emitProgress(
    request: AgentDecisionXmlCollectRequest,
    snapshot: AgentDecisionXmlStreamSnapshot,
  ): Promise<void> {
    await emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.DecisionXmlProgress,
      context: {
        requestId: request.requestId,
        step: request.step,
      },
      data: {
        state: snapshot.state,
        xml: snapshot.candidateXml,
        ...this.extractStreamingPreview(snapshot.rawText, request.rootCommand),
      },
    });
  }

  async emitLimitReached(
    request: AgentDecisionXmlCollectRequest,
    budget: AgentExceededTextBudgetSnapshot,
  ): Promise<void> {
    await emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.DecisionXmlLimitReached,
      context: {
        requestId: request.requestId,
        step: request.step,
      },
      data: {
        code: "DecisionXmlTokenLimitExceeded",
        model: budget.model,
        encodingName: budget.encodingName,
        tokenCount: budget.tokenCount,
        tokenLimit: budget.tokenLimit,
        exceededTokens: budget.exceededTokens,
        resolution: budget.resolution,
      },
    });
  }

  async emitModelStreamAborted(
    request: AgentDecisionXmlCollectRequest,
    reason: string,
  ): Promise<void> {
    await emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.ModelStreamAborted,
      context: {
        requestId: request.requestId,
        step: request.step,
      },
      data: {
        reason,
      },
    });
  }

  async emitModelCompleted(
    request: AgentDecisionXmlCollectRequest,
    text: string,
  ): Promise<void> {
    await emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.ModelCompleted,
      context: {
        requestId: request.requestId,
        step: request.step,
      },
      data: {
        text,
      },
    });
  }

  async emitDecisionXmlArtifacts(
    request: Pick<AgentDecisionXmlCollectRequest, "requestId" | "step" | "onEvent">,
    xml: string,
    options: {
      sanitized: boolean;
      rawXml?: string;
    },
  ): Promise<void> {
    const detailId = createEventDetailId(
      request.requestId,
      request.step,
      AgentEventKinds.DecisionXmlDetail,
      options.sanitized ? "sanitized" : "raw",
    );
    const summary = summarizeXmlDocument(xml, {
      sanitized: options.sanitized,
      detailId,
    });

    await emitAgentEvent(request.onEvent, {
      kind: summary.kind,
      context: {
        requestId: request.requestId,
        step: request.step,
      },
      data: summary.data,
    });
    await emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.DecisionXmlDetail,
      context: {
        requestId: request.requestId,
        step: request.step,
      },
      data: {
        detailId,
        xml,
        rawXml: options.rawXml,
        sanitized: options.sanitized,
      },
    });
  }

  private extractStreamingPreview(
    text: string,
    rootCommand: AgentRootCommand | undefined,
  ) {
    return rootCommand?.outputMode === "tool_call_xml"
      ? {
          kind: "tool_calls" as const,
          text: "",
          preambleText: "",
        }
      : extractDecisionStreamingPreview(
          text,
          this.policy,
          this.previewRules,
        );
  }
}
