import { AgentXmlSourceHelper } from "../Xml/AgentXmlParser.js";
import type { AgentXmlProtocolSpec } from "../Xml/AgentXmlPolicy.js";
import { AgentExecutionErrorCodes } from "../Xml/AgentXmlStatus.js";
import { AgentDecisionErrorFactory } from "./AgentDecisionErrorFactory.js";
import type {
  AgentToolCallsDecision,
  AgentToolControlResult,
  ExecutedDecisionToolCall,
} from "./AgentDecisionExecutionTypes.js";

export class AgentDecisionToolControlPolicy {
  constructor(
    private readonly errors: AgentDecisionErrorFactory,
    private readonly protocol: AgentXmlProtocolSpec,
  ) {}

  read(result: unknown): AgentToolControlResult | undefined {
    const control = readObjectField(result, "control");
    if (!control || control.kind !== "AskUser") {
      return undefined;
    }

    const question = readRequiredString(control, "question", "AskUser 控制结果缺少 question。");
    return {
      kind: "AskUser",
      value: {
        question,
        reason_code: readOptionalString(control, "reason_code"),
      },
    };
  }

  selectExclusive(
    decision: AgentToolCallsDecision,
    results: readonly ExecutedDecisionToolCall[],
  ): AgentToolControlResult | undefined {
    const controls = results.flatMap((entry) =>
      entry.control ? [{ ...entry, control: entry.control }] : []);
    if (controls.length === 0) {
      return undefined;
    }

    if (results.length !== 1) {
      throw this.errors.createRetryable({
        code: AgentExecutionErrorCodes.InvalidToolArguments,
        message: "询问用户的控制工具必须单独调用，不能和其它工具调用混用。",
        diagnostics: controls.map(({ index, tool }) =>
          new AgentXmlSourceHelper(decision.source.xml).diagnosticForPath(
            `需要暂停并询问用户的工具必须单独调用：${tool.name}`,
            decision.root,
            [this.protocol.items.toolCall, index, "name"],
            "只保留这一个询问用户的工具调用。",
          )),
        heading: "上一条工具调用组合无效。",
        details: {
          controlTools: controls.map(({ tool }) => tool.name),
        },
      });
    }

    return controls[0].control;
  }
}

function readObjectField(
  value: unknown,
  key: string,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const field = (value as Record<string, unknown>)[key];
  return field && typeof field === "object" && !Array.isArray(field)
    ? field as Record<string, unknown>
    : undefined;
}

function readRequiredString(
  value: Record<string, unknown>,
  key: string,
  message: string,
): string {
  const text = readOptionalString(value, key);
  if (!text) {
    throw new Error(message);
  }
  return text;
}

function readOptionalString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const text = typeof value[key] === "string" ? value[key].trim() : "";
  return text.length > 0 ? text : undefined;
}
