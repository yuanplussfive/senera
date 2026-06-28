import { AgentRetryableError } from "../Retry/AgentRetryableError.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentActionMismatchRepairPromptBuilder } from "../ActionPlanner/AgentActionMismatchRepairPromptBuilder.js";
import { AgentXmlErrorCodes } from "../Xml/AgentXmlStatus.js";
import type {
  AgentDecisionOutputContract,
  AgentDecisionOutputShape,
} from "./AgentDecisionOutputResolver.js";

export class AgentDecisionXmlCollectionRetryableError extends AgentRetryableError {
  constructor(
    readonly responseText: string,
    instruction: ConstructorParameters<typeof AgentRetryableError>[0],
  ) {
    super(instruction);
  }
}

export class AgentDecisionXmlCollectionErrorFactory {
  constructor(
    private readonly actionMismatchRepairPromptBuilder: AgentActionMismatchRepairPromptBuilder,
    private readonly toolCallsRoot: string,
  ) {}

  actionMismatch(options: {
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
      repairPrompt: this.actionMismatchRepairPromptBuilder.build({
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

  incompleteToolCalls(
    text: string,
    rootCommand: AgentRootCommand | undefined,
  ): AgentDecisionXmlCollectionRetryableError {
    const rootTag = `<${this.toolCallsRoot}>`;
    const message = `模型尝试输出工具调用，但 ${rootTag} XML 没有形成完整、合法的根节点。`;
    return new AgentDecisionXmlCollectionRetryableError(text, {
      retryable: true,
      code: AgentXmlErrorCodes.IncompleteXmlEnvelope,
      message,
      diagnostics: [{
        message,
        pointer: `/${this.toolCallsRoot}`,
        suggestion: rootCommand?.visibleOutput.repair.instruction,
      }],
      repairPrompt: rootCommand
        ? this.actionMismatchRepairPromptBuilder.build({
            code: AgentXmlErrorCodes.IncompleteXmlEnvelope,
            expected: rootCommand.outputMode,
            actual: "tool_envelope_fragment",
            rootCommand,
          })
        : undefined,
    });
  }
}
