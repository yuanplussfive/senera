import { AgentDecisionXmlEnvelopeAnalyzer } from "./AgentDecisionXmlEnvelopeAnalyzer.js";
import { createDecisionStreamingPreviewRules } from "./AgentDecisionStreamingPreview.js";
import {
  AgentForbiddenOutputXmlGuard,
  AgentForbiddenOutputXmlRetryableError,
} from "../Xml/AgentForbiddenOutputXmlGuard.js";
import {
  AgentDecisionOutputResolver,
} from "./AgentDecisionOutputResolver.js";
import { AgentDecisionXmlCollectionEvents } from "./AgentDecisionXmlCollectionEvents.js";
import {
  AgentDecisionXmlCollectionErrorFactory,
  AgentDecisionXmlCollectionRetryableError,
} from "./AgentDecisionXmlCollectionErrors.js";
import {
  AgentDecisionXmlStreamCollector,
} from "./AgentDecisionXmlStreamCollector.js";
import { AgentDecisionXmlUsageEstimator } from "./AgentDecisionXmlUsageEstimator.js";
import type { AgentDecisionXmlStreamSnapshot } from "./AgentDecisionXmlStreamAssembler.js";
import {
  type AgentDecisionXmlCollectRequest,
  type AgentDecisionXmlCollectorOptions,
  type DecisionXmlCollectionResult,
} from "./AgentDecisionXmlCollectionTypes.js";

export type {
  AgentDecisionXmlCollectRequest,
  AgentDecisionXmlCollectorOptions,
  DecisionXmlCollectionResult,
} from "./AgentDecisionXmlCollectionTypes.js";
export {
  AgentDecisionXmlCollectionRetryableError,
} from "./AgentDecisionXmlCollectionErrors.js";

export class AgentDecisionXmlCollector {
  private readonly analyzer: AgentDecisionXmlEnvelopeAnalyzer;
  private readonly allowedRoots: ReadonlySet<string>;
  private readonly toolCallsRoot: string;
  private readonly forbiddenOutputGuard: AgentForbiddenOutputXmlGuard;
  private readonly outputResolver: AgentDecisionOutputResolver;
  private readonly events: AgentDecisionXmlCollectionEvents;
  private readonly errors: AgentDecisionXmlCollectionErrorFactory;
  private readonly streamCollector: AgentDecisionXmlStreamCollector;
  private readonly usage: AgentDecisionXmlUsageEstimator;

  constructor(private readonly options: AgentDecisionXmlCollectorOptions) {
    const toolCallsAction = options.decisionActions?.find((action) => action.kind === "ToolCalls");
    this.toolCallsRoot = toolCallsAction?.xmlRoot ?? options.policy.protocol.roots.toolCalls;
    this.allowedRoots = new Set([this.toolCallsRoot]);
    this.forbiddenOutputGuard = new AgentForbiddenOutputXmlGuard(options.policy.protocol);
    this.analyzer = new AgentDecisionXmlEnvelopeAnalyzer({
      policy: options.policy,
      acceptRoot: (rootName) => this.allowedRoots.has(rootName),
      allowEmbeddedCandidates: true,
      candidateNormalizer: options.candidateNormalizer,
    });
    this.outputResolver = new AgentDecisionOutputResolver({
      policy: options.policy,
      toolCallsRoot: this.toolCallsRoot,
      acceptRoot: (rootName) => this.allowedRoots.has(rootName),
      candidateNormalizer: options.candidateNormalizer,
    });
    this.events = new AgentDecisionXmlCollectionEvents(
      options.policy,
      createDecisionStreamingPreviewRules(options.decisionActions),
    );
    this.errors = new AgentDecisionXmlCollectionErrorFactory(
      options.actionMismatchRepairPromptBuilder,
      this.toolCallsRoot,
    );
    this.streamCollector = new AgentDecisionXmlStreamCollector({
      model: options.model,
      policy: options.policy,
      textBudget: options.textBudget,
      acceptRoot: (rootName) => this.allowedRoots.has(rootName),
      candidateNormalizer: options.candidateNormalizer,
      events: this.events,
    });
    this.usage = new AgentDecisionXmlUsageEstimator(options.tokenEstimator);
  }

  async collect(request: AgentDecisionXmlCollectRequest): Promise<DecisionXmlCollectionResult> {
    const collected = await this.streamCollector.collect(request);
    if (collected.kind === "token_limit") {
      return {
        kind: "token_limit",
        text: collected.text,
        budget: collected.budget,
        modelProvider: collected.modelProvider,
        usage: this.usage.estimate(collected.text),
      };
    }

    const pureSnapshot = this.readPureToolCallsSnapshot(
      collected.snapshot,
      collected.text,
    );
    const resolved = this.outputResolver.resolve({
      text: collected.text,
      rootCommand: request.rootCommand,
      pureToolXml: pureSnapshot?.candidateXml,
    });

    if (resolved.kind === "action_mismatch") {
      throw this.errors.actionMismatch({
        ...resolved,
        rootCommand: request.rootCommand,
      });
    }

    if (resolved.kind === "final_text") {
      if (this.containsToolCallsIntent(collected.text)) {
        throw this.errors.incompleteToolCalls(collected.text, request.rootCommand);
      }

      const forbidden = this.forbiddenOutputGuard.inspect(collected.text);
      if (forbidden) {
        throw new AgentForbiddenOutputXmlRetryableError(collected.text, forbidden);
      }

      return {
        kind: "final_text",
        text: resolved.text,
        modelProvider: collected.modelProvider,
        usage: this.usage.estimate(resolved.text),
      };
    }

    await this.events.emitDecisionXmlArtifacts(request, resolved.xml, {
      sanitized: false,
      rawXml: resolved.recovered ? resolved.text : undefined,
    });

    return {
      kind: "tool_calls",
      text: resolved.text,
      toolCallsXml: resolved.xml,
      stopReason: "stream_completed",
      modelProvider: collected.modelProvider,
      usage: this.usage.estimate(collected.text),
    };
  }

  private readPureToolCallsSnapshot(
    snapshot: AgentDecisionXmlStreamSnapshot,
    text: string,
  ): Extract<AgentDecisionXmlStreamSnapshot, { state: "root_closed" }> | undefined {
    return snapshot.state === "root_closed" && snapshot.candidateXml.trim() === text.trim()
      ? snapshot
      : undefined;
  }

  private containsToolCallsIntent(text: string): boolean {
    if (!this.outputResolver.hasToolEnvelopeStart(text)) {
      return false;
    }

    const boundary = this.analyzer.findFirstCompleteBoundary(text.trimStart());
    return boundary === undefined;
  }
}
