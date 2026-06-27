import {
  AgentEventKinds,
  createEventDetailId,
  emitAgentEvent,
  summarizeXmlDocument,
  type AgentEventSink,
} from "./AgentEvent.js";
import { AgentRetryableError } from "./AgentRetryableError.js";
import type { AgentLanguageModel, AgentLanguageModelMessage } from "./AgentLanguageModel.js";
import { AgentDecisionXmlEnvelopeAnalyzer } from "./AgentDecisionXmlEnvelopeAnalyzer.js";
import { AgentDecisionXmlStreamAssembler } from "./AgentDecisionXmlStreamAssembler.js";
import { AgentCancellationError } from "./AgentLoop.js";
import {
  createDecisionStreamingPreviewRules,
  extractDecisionStreamingPreview,
  type DecisionStreamingPreviewRule,
} from "./AgentDecisionStreamingPreview.js";
import type { AgentTextBudgetEvaluator, AgentExceededTextBudgetSnapshot } from "./AgentTextBudget.js";
import type { AgentXmlProtocolPolicy } from "./AgentXmlPolicy.js";
import type { AgentXmlCandidateNormalizer } from "./AgentToolCallsXmlNormalizer.js";
import type { RegisteredDecisionAction } from "./Types/PluginRuntimeTypes.js";
import type { AgentModelProviderMetadata, AgentModelUsage } from "./AgentModelMetadata.js";
import { AgentXmlErrorCodes } from "./AgentXmlStatus.js";
import {
  AgentForbiddenOutputXmlGuard,
  AgentForbiddenOutputXmlRetryableError,
} from "./AgentForbiddenOutputXmlGuard.js";
import {
  AgentDecisionOutputResolver,
  type AgentDecisionOutputContract,
  type AgentDecisionOutputShape,
} from "./AgentDecisionOutputResolver.js";
import type { AgentActionMismatchRepairPromptBuilder } from "./AgentActionMismatchRepairPromptBuilder.js";
import type { AgentRootCommand } from "./AgentRootCommand.js";

export type DecisionXmlCollectionResult =
  | {
      kind: "tool_calls";
      text: string;
      toolCallsXml: string;
      stopReason: "root_closed" | "stream_completed";
      modelProvider: AgentModelProviderMetadata;
      usage: AgentModelUsage;
    }
  | {
      kind: "final_text";
      text: string;
      modelProvider: AgentModelProviderMetadata;
      usage: AgentModelUsage;
    }
  | {
      kind: "token_limit";
      text: string;
      budget: AgentExceededTextBudgetSnapshot;
      modelProvider: AgentModelProviderMetadata;
      usage: AgentModelUsage;
    };

export interface AgentDecisionXmlCollectorOptions {
  model: AgentLanguageModel;
  policy: AgentXmlProtocolPolicy;
  textBudget: AgentTextBudgetEvaluator;
  tokenEstimator: {
    estimate(text: string): {
      tokenCount: number;
    };
  };
  decisionActions?: readonly Pick<RegisteredDecisionAction, "kind" | "xmlRoot">[];
  candidateNormalizer?: AgentXmlCandidateNormalizer;
  actionMismatchRepairPromptBuilder: AgentActionMismatchRepairPromptBuilder;
}

export class AgentDecisionXmlCollectionRetryableError extends AgentRetryableError {
  constructor(
    readonly responseText: string,
    instruction: ConstructorParameters<typeof AgentRetryableError>[0],
  ) {
    super(instruction);
  }
}

export class AgentDecisionXmlCollector {
  private readonly analyzer: AgentDecisionXmlEnvelopeAnalyzer;
  private readonly previewRules: readonly DecisionStreamingPreviewRule[];
  private readonly allowedRoots: ReadonlySet<string>;
  private readonly toolCallsRoot: string;
  private readonly forbiddenOutputGuard: AgentForbiddenOutputXmlGuard;
  private readonly outputResolver: AgentDecisionOutputResolver;

  constructor(private readonly options: AgentDecisionXmlCollectorOptions) {
    this.previewRules = createDecisionStreamingPreviewRules(options.decisionActions);
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
  }

  async collect(request: {
    requestId: string;
    step: number;
    systemPrompt: string;
    messages: AgentLanguageModelMessage[];
    rootCommand?: AgentRootCommand;
    onEvent?: AgentEventSink;
    signal?: AbortSignal;
  }): Promise<DecisionXmlCollectionResult> {
    // 取消信号若已经触发，直接报，连流都不开
    if (request.signal?.aborted) {
      throw new AgentCancellationError();
    }

    const stream = await this.options.model.stream(request);
    const assembler = new AgentDecisionXmlStreamAssembler({
      policy: this.options.policy,
      acceptRoot: (rootName) => this.allowedRoots.has(rootName),
      allowEmbeddedCandidates: false,
      allowFencedEnvelope: false,
      candidateNormalizer: this.options.candidateNormalizer,
    });

    let text = "";
    let toolCallsSnapshot: ReturnType<AgentDecisionXmlStreamAssembler["current"]> | undefined;

    // 把 cancel signal 绑到 stream.abort()：用户点 stop 时，上游模型流也立刻断
    const abortListener = (): void => {
      stream.abort();
    };
    request.signal?.addEventListener("abort", abortListener, { once: true });

    try {
      for await (const chunk of stream) {
        const snapshot = assembler.push(chunk.textDelta);
        const budget = this.options.textBudget.measure(snapshot.candidateXml);
        text = snapshot.rawText;

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

        if (budget.state === "limit_reached") {
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
          stream.abort();
          await emitAgentEvent(request.onEvent, {
            kind: AgentEventKinds.ModelStreamAborted,
            context: {
              requestId: request.requestId,
              step: request.step,
            },
            data: {
              reason: "decision_xml_token_limit_exceeded",
            },
          });
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
          await this.emitDecisionXmlArtifacts(request, text, {
            sanitized: false,
          });
          return {
            kind: "token_limit",
            text,
            budget,
            modelProvider: stream.metadata,
            usage: this.estimateOutputUsage(text),
          };
        }

        if (snapshot.state === "root_closed") {
          toolCallsSnapshot = snapshot;
        }
      }
    } catch (error) {
      // 流被外部 abort 时，上游适配器会抛错。区分"用户取消"和"真错误"靠 signal 本身，而不是错误文本。
      if (request.signal?.aborted) {
        throw new AgentCancellationError();
      }
      throw error;
    } finally {
      request.signal?.removeEventListener("abort", abortListener);
    }

    // 循环正常结束后再确认一次：可能 stream 自然结束的瞬间用户也点了取消
    if (request.signal?.aborted) {
      throw new AgentCancellationError();
    }

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

    const pureSnapshot = this.readPureToolCallsSnapshot(
      toolCallsSnapshot ?? assembler.current(),
      text,
    );
    const resolved = this.outputResolver.resolve({
      text,
      rootCommand: request.rootCommand,
      pureToolXml: pureSnapshot?.candidateXml,
    });

    if (resolved.kind === "action_mismatch") {
      throw this.buildActionMismatchError({
        ...resolved,
        rootCommand: request.rootCommand,
      });
    }

    if (resolved.kind === "final_text") {
      if (this.containsToolCallsIntent(text)) {
        throw this.buildIncompleteToolCallsError(text, request.rootCommand);
      }

      const forbidden = this.forbiddenOutputGuard.inspect(text);
      if (forbidden) {
        throw new AgentForbiddenOutputXmlRetryableError(text, forbidden);
      }

      return {
        kind: "final_text",
        text: resolved.text,
        modelProvider: stream.metadata,
        usage: this.estimateOutputUsage(resolved.text),
      };
    }

    await this.emitDecisionXmlArtifacts(request, resolved.xml, {
      sanitized: false,
      rawXml: resolved.recovered ? resolved.text : undefined,
    });

    return {
      kind: "tool_calls",
      text: resolved.text,
      toolCallsXml: resolved.xml,
      stopReason: "stream_completed",
      modelProvider: stream.metadata,
      usage: this.estimateOutputUsage(text),
    };
  }

  private readPureToolCallsSnapshot(
    snapshot: ReturnType<AgentDecisionXmlStreamAssembler["current"]>,
    text: string,
  ): Extract<ReturnType<AgentDecisionXmlStreamAssembler["current"]>, { state: "root_closed" }> | undefined {
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

  private buildActionMismatchError(options: {
    text: string;
    expected: AgentDecisionOutputContract;
    actual: AgentDecisionOutputShape["kind"];
    rootCommand?: AgentRootCommand;
  }): AgentDecisionXmlCollectionRetryableError {
    const code = AgentXmlErrorCodes.MixedXmlContent;
    const message = `模型输出形态与本轮 RootCommand 不一致：期望 ${options.expected}，实际是 ${options.actual}。`;
    return new AgentDecisionXmlCollectionRetryableError(options.text, {
      retryable: true,
      code,
      message,
      diagnostics: [{
        message,
        pointer: "/",
        suggestion: options.rootCommand?.visibleOutput.repair.instruction,
      }],
      repairPrompt: this.buildActionMismatchRepairPrompt({
        code,
        expected: options.expected,
        actual: options.actual,
        rootCommand: options.rootCommand,
      }),
      details: {
        expected: options.expected,
        actual: options.actual,
        suppressAssistantRepairEcho: true,
        previousOutputShape: options.actual,
      },
    });
  }

  private buildActionMismatchRepairPrompt(options: {
    code: typeof AgentXmlErrorCodes.MixedXmlContent;
    expected: AgentDecisionOutputContract;
    actual: AgentDecisionOutputShape["kind"];
    rootCommand?: AgentRootCommand;
  }): string {
    return this.options.actionMismatchRepairPromptBuilder.build(options);
  }

  private buildIncompleteToolCallsError(
    text: string,
    rootCommand: AgentRootCommand | undefined,
  ): AgentDecisionXmlCollectionRetryableError {
    const rootTag = `<${this.toolCallsRoot}>`;
    return new AgentDecisionXmlCollectionRetryableError(text, {
      retryable: true,
      code: AgentXmlErrorCodes.IncompleteXmlEnvelope,
      message: `模型尝试输出工具调用，但 ${rootTag} XML 没有形成完整、合法的根节点。`,
      diagnostics: [{
        message: `模型尝试输出工具调用，但 ${rootTag} XML 没有形成完整、合法的根节点。`,
        pointer: `/${this.toolCallsRoot}`,
        suggestion: rootCommand?.visibleOutput.repair.instruction,
      }],
      repairPrompt: rootCommand
        ? this.options.actionMismatchRepairPromptBuilder.build({
            code: AgentXmlErrorCodes.IncompleteXmlEnvelope,
            expected: rootCommand.outputMode,
            actual: "tool_envelope_fragment",
            rootCommand,
          })
        : undefined,
    });
  }

  private estimateOutputUsage(text: string): AgentModelUsage {
    return {
      source: "local_estimate",
      outputTokens: this.options.tokenEstimator.estimate(text).tokenCount,
    };
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
          this.options.policy,
          this.previewRules,
        );
  }

  private async emitDecisionXmlArtifacts(
    request: {
      requestId: string;
      step: number;
      onEvent?: AgentEventSink;
    },
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
}
