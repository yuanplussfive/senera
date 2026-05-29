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
import type { RegisteredDecisionAction } from "./Types.js";
import type { AgentModelProviderMetadata, AgentModelUsage } from "./AgentModelMetadata.js";
import { AgentXmlErrorCodes } from "./AgentXmlStatus.js";

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

  constructor(private readonly options: AgentDecisionXmlCollectorOptions) {
    this.previewRules = createDecisionStreamingPreviewRules(options.decisionActions);
    const toolCallsAction = options.decisionActions?.find((action) => action.kind === "ToolCalls");
    this.toolCallsRoot = toolCallsAction?.xmlRoot ?? "tool_calls";
    this.allowedRoots = new Set([this.toolCallsRoot]);
    this.analyzer = new AgentDecisionXmlEnvelopeAnalyzer({
      policy: options.policy,
      acceptRoot: (rootName) => this.allowedRoots.has(rootName),
      allowEmbeddedCandidates: true,
      candidateNormalizer: options.candidateNormalizer,
    });
  }

  async collect(request: {
    requestId: string;
    step: number;
    systemPrompt: string;
    messages: AgentLanguageModelMessage[];
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
      allowEmbeddedCandidates: true,
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
            ...extractDecisionStreamingPreview(
              snapshot.rawText,
              this.options.policy,
              this.previewRules,
            ),
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
          await emitAgentEvent(request.onEvent, {
            kind: AgentEventKinds.DecisionXmlReady,
            context: {
              requestId: request.requestId,
              step: request.step,
            },
            data: {
              stopReason: "root_closed",
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
              reason: "xml_root_closed",
            },
          });
          break;
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

    const snapshot = toolCallsSnapshot ?? assembler.current();
    if (snapshot.state !== "root_closed") {
      const embedded = this.findEmbeddedToolCalls(text);
      if (embedded) {
        await this.emitDecisionXmlArtifacts(request, embedded.xml, {
          sanitized: embedded.sanitized,
          rawXml: embedded.sanitized ? text : undefined,
        });

        return {
          kind: "tool_calls",
          text,
          toolCallsXml: embedded.xml,
          stopReason: "stream_completed",
          modelProvider: stream.metadata,
          usage: this.estimateOutputUsage(text),
        };
      }

      if (this.containsToolCallsIntent(text)) {
        throw new AgentDecisionXmlCollectionRetryableError(text, {
          retryable: true,
          code: AgentXmlErrorCodes.IncompleteXmlEnvelope,
          message: "模型尝试输出工具调用，但 <tool_calls> XML 没有形成完整、合法的根节点。",
          diagnostics: [{
            message: "模型尝试输出工具调用，但 <tool_calls> XML 没有形成完整、合法的根节点。",
            pointer: "/tool_calls",
            suggestion: "重新输出一个完整的 <tool_calls> 根标签；标签名、开始标签和结束标签必须保持完整，参数文本放在对应字段内部。",
          }],
          repairPrompt: [
            "上一条回复尝试调用工具，但 <tool_calls> XML 结构损坏。",
            "只输出修正后的完整 <tool_calls> XML，不要输出解释文本。",
            "标签名、开始标签和结束标签必须保持完整。",
            "参数文本放在对应字段内部，不要插入到标签名或结束标签中。",
          ].join("\n"),
        });
      }

      return {
        kind: "final_text",
        text,
        modelProvider: stream.metadata,
        usage: this.estimateOutputUsage(text),
      };
    }

    await this.emitDecisionXmlArtifacts(request, snapshot.candidateXml, {
      sanitized: false,
      rawXml: snapshot.candidateXml === snapshot.rawText ? undefined : snapshot.rawText,
    });

    return {
      kind: "tool_calls",
      text,
      toolCallsXml: snapshot.rawText,
      stopReason: "root_closed",
      modelProvider: stream.metadata,
      usage: this.estimateOutputUsage(text),
    };
  }

  private findEmbeddedToolCalls(text: string): {
    xml: string;
    sanitized: boolean;
  } | undefined {
    const candidate = this.analyzer.findFirstCompleteCandidate(text, {
      acceptRoot: (rootName) => this.allowedRoots.has(rootName),
    });
    if (!candidate) {
      return undefined;
    }

    const boundary = this.analyzer.findFirstCompleteBoundary(candidate.xmlText);
    if (boundary === undefined) {
      return undefined;
    }

    const xml = candidate.xmlText.slice(0, boundary).trim();
    return {
      xml,
      sanitized: xml !== text.trim(),
    };
  }

  private containsToolCallsIntent(text: string): boolean {
    return text.toLowerCase().includes(`<${this.toolCallsRoot.toLowerCase()}`);
  }

  private estimateOutputUsage(text: string): AgentModelUsage {
    return {
      source: "local_estimate",
      outputTokens: this.options.tokenEstimator.estimate(text).tokenCount,
    };
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
