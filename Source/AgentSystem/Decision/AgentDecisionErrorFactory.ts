import { AgentRetryableError } from "../AgentRetryableError.js";
import { AgentRetryDiagnostics } from "../AgentRetryDiagnostics.js";
import type { AgentPromptRenderer } from "../Prompt/AgentPromptRenderer.js";
import type { AgentPluginRegistry } from "../Plugin/AgentPluginRegistry.js";
import type { AgentExceededTextBudgetSnapshot } from "../AgentTextBudget.js";
import type { AgentXmlProtocolSpec } from "../Xml/AgentXmlPolicy.js";
import {
  AgentExecutionErrorCodes,
  AgentXmlErrorCodes,
  isAgentProtocolErrorCode,
} from "../Xml/AgentXmlStatus.js";
import type { AgentXmlParseError, AgentXmlSourceHelper } from "../Xml/AgentXmlParser.js";
import type { AgentSchemaValidationError } from "../AgentSchemaValidator.js";
import type { AgentToolProcessError } from "../Types/ToolRuntimeTypes.js";
import type { AgentDecisionErrorSpec } from "./AgentDecisionErrorTypes.js";
import { AgentDecisionRootSuggestions } from "./AgentDecisionRootSuggestions.js";
import { buildDecisionSchemaDiagnostics } from "./AgentDecisionSchemaDiagnostics.js";
import {
  remapToolDiagnostics,
  toolCallPath,
} from "./AgentDecisionToolDiagnostics.js";

export type { AgentDecisionErrorSpec } from "./AgentDecisionErrorTypes.js";

export class AgentDecisionErrorFactory {
  private readonly retryDiagnostics?: AgentRetryDiagnostics;
  private readonly roots: AgentDecisionRootSuggestions;

  constructor(options?: {
    registry: AgentPluginRegistry;
    promptRenderer: AgentPromptRenderer;
    workspaceRoot: string;
    protocol?: AgentXmlProtocolSpec;
  }) {
    this.roots = new AgentDecisionRootSuggestions(options?.registry, options?.protocol);
    this.retryDiagnostics = options
      ? new AgentRetryDiagnostics(options)
      : undefined;
  }

  createRetryable(spec: AgentDecisionErrorSpec): AgentRetryableError {
    const fallback = [
      spec.heading ?? "上一条 XML 决策没有通过解析或校验。",
      `错误代码：${spec.code}`,
      "只输出修正后的 XML，不要输出解释文本。",
      `当前 XML 修复只适用于工具调用；根标签必须是 <${this.roots.toolCallsRootName()}>。`,
    ].join("\n");

    return new AgentRetryableError({
      retryable: true,
      code: spec.code,
      message: spec.message,
      diagnostics: spec.diagnostics,
      repairPrompt: this.retryDiagnostics
        ? this.retryDiagnostics.buildXmlRepairPrompt(
            spec.code,
            spec.diagnostics ?? [],
            spec.heading,
          )
        : fallback,
      details: spec.details,
    });
  }

  fromSanitizerFailure(error: unknown): AgentRetryableError {
    const parseError = this.asXmlParseError(error);
    return this.createRetryable({
      code:
        parseError && isAgentProtocolErrorCode(parseError.details?.code)
          ? parseError.details.code
          : AgentXmlErrorCodes.InvalidXmlEnvelope,
      message: error instanceof Error ? error.message : String(error),
      diagnostics: parseError?.diagnostics ?? [],
      details: parseError?.details,
    });
  }

  fromXmlParseFailure(error: unknown): AgentRetryableError {
    const parseError = this.asXmlParseError(error);
    return this.createRetryable({
      code: parseError?.code ?? AgentXmlErrorCodes.InvalidXmlSyntax,
      message: error instanceof Error ? error.message : String(error),
      diagnostics: parseError?.diagnostics ?? [],
      details: parseError?.details,
    });
  }

  emptyDecisionXml(): AgentRetryableError {
    return this.createRetryable({
      code: AgentXmlErrorCodes.EmptyDecisionXml,
      message: "XML 输出为空。",
      diagnostics: [{
        message: "XML 输出为空。",
        pointer: "/",
        suggestion: this.roots.allowedRootSuggestion(),
      }],
      details: {
        allowedRoots: this.roots.allowedDecisionRoots(),
      },
    });
  }

  invalidDecisionRoot(options: {
    source: AgentXmlSourceHelper;
    allowedRoots: string[];
  }): AgentRetryableError {
    const suggestion = [
      "当前输出没有可识别的决策根标签。",
      this.roots.allowedRootSuggestion(options.allowedRoots),
      "整条回复必须直接从一个允许的 XML 根标签开始，不要只输出结束标签、处理指令、注释或空标签名。",
    ].join(" ");

    return this.createRetryable({
      code: AgentXmlErrorCodes.InvalidXmlEnvelope,
      message: "模型输出中没有可识别的 XML 决策根标签。",
      diagnostics: [
        options.source.diagnosticForOffset(
          "模型输出中没有可识别的 XML 决策根标签。",
          0,
          suggestion,
          {
            pointer: "/",
          },
        ),
      ],
      details: {
        allowedRoots: options.allowedRoots,
        suggestion,
      },
    });
  }

  unknownDecisionRoot(options: {
    rootName: string;
    source: AgentXmlSourceHelper;
    allowedRoots: string[];
  }): AgentRetryableError {
    const suggestion = this.roots.unknownDecisionRoot(options);
    const diagnostics = [
      options.source.diagnosticForRoot(
        `未知决策根标签：${options.rootName}`,
        options.rootName,
        suggestion,
      ),
    ];

    return this.createRetryable({
      code: AgentXmlErrorCodes.UnknownDecisionRoot,
      message: `未知决策根标签：${options.rootName}`,
      diagnostics,
      details: {
        allowedRoots: options.allowedRoots,
        suggestion,
      },
    });
  }

  invalidDecisionPayload(options: {
    rootName: string;
    source: AgentXmlSourceHelper;
    error: AgentSchemaValidationError;
  }): AgentRetryableError {
    const diagnostics = buildDecisionSchemaDiagnostics(
      options.source,
      options.rootName,
      [],
      options.error.issues,
    );

    return this.createRetryable({
      code: AgentXmlErrorCodes.InvalidDecisionPayload,
      message: options.error.message,
      diagnostics,
      details: {
        root: options.rootName,
        schemaPath: options.error.schemaPath,
        issues: options.error.issues,
      },
    });
  }

  unknownToolName(options: {
    rootName: string;
    source: AgentXmlSourceHelper;
    protocol: AgentXmlProtocolSpec;
    callIndex: number;
    toolName: string;
    allowedTools: string[];
  }): AgentRetryableError {
    const diagnostics = [
      options.source.diagnosticForPath(
        `未知工具：${options.toolName}`,
        options.rootName,
        toolCallPath(options.protocol, options.callIndex, "name"),
        `把 <name> 改成已注册工具之一：${options.allowedTools.join(", ")}。`,
      ),
    ];

    return this.createRetryable({
      code: AgentExecutionErrorCodes.UnknownToolName,
      message: `未知工具：${options.toolName}`,
      diagnostics,
      heading: "上一条工具调用无法执行。",
      details: {
        toolName: options.toolName,
        allowedTools: options.allowedTools,
      },
    });
  }

  invalidToolArguments(options: {
    rootName: string;
    source: AgentXmlSourceHelper;
    protocol: AgentXmlProtocolSpec;
    callIndex: number;
    toolName: string;
    error: AgentSchemaValidationError;
  }): AgentRetryableError {
    const diagnostics = buildDecisionSchemaDiagnostics(
      options.source,
      options.rootName,
      toolCallPath(options.protocol, options.callIndex, "arguments"),
      options.error.issues,
    );

    return this.createRetryable({
      code: AgentExecutionErrorCodes.InvalidToolArguments,
      message: `工具参数校验失败：${options.toolName}`,
      diagnostics,
      heading: "上一条工具调用参数没有通过工具 schema 校验。",
      details: {
        tool: options.toolName,
        schemaPath: options.error.schemaPath,
        issues: options.error.issues,
      },
    });
  }

  toolExecutionFailure(options: {
    rootName: string;
    source: AgentXmlSourceHelper;
    protocol: AgentXmlProtocolSpec;
    callIndex: number;
    toolName: string;
    error?: AgentToolProcessError;
  }): AgentRetryableError {
    const argumentsPath = toolCallPath(options.protocol, options.callIndex, "arguments");
    const diagnostics = remapToolDiagnostics(
      options.source,
      options.rootName,
      argumentsPath,
      options.error?.diagnostics,
      options.error?.message ?? `工具执行失败：${options.toolName}。`,
    );

    return this.createRetryable({
      code: options.error?.code ?? AgentExecutionErrorCodes.PluginExecutionError,
      message: `工具执行失败：${options.toolName}：${options.error?.message ?? "未知错误"}`,
      diagnostics,
      heading: "上一条工具调用在插件执行阶段失败了。",
      details: {
        tool: options.toolName,
        ...options.error?.details,
      },
    });
  }

  decisionXmlTokenLimitExceeded(
    budget: AgentExceededTextBudgetSnapshot,
  ): AgentRetryableError {
    const diagnostics = [
      {
        message: `XML 输出在流式阶段超过 token 上限：${budget.tokenCount}/${budget.tokenLimit}。`,
        pointer: "/",
        suggestion: "压缩输出，只保留一个更短的 XML 决策，不要附加解释文本或冗余字段。",
      },
    ];

    return this.createRetryable({
      code: AgentXmlErrorCodes.DecisionXmlTokenLimitExceeded,
      message: `XML 输出超过最大 token 限制：${budget.tokenCount}/${budget.tokenLimit}。`,
      diagnostics,
      heading: "上一条 XML 决策在流式输出阶段超过了 token 限制。",
      details: {
        model: budget.model,
        encodingName: budget.encodingName,
        resolution: budget.resolution,
        tokenCount: budget.tokenCount,
        tokenLimit: budget.tokenLimit,
        exceededTokens: budget.exceededTokens,
      },
    });
  }

  private asXmlParseError(error: unknown): AgentXmlParseError | undefined {
    return error instanceof Error && "diagnostics" in error && "code" in error
      ? error as AgentXmlParseError
      : undefined;
  }
}
