import type { AgentSourceDiagnostic } from "./AgentSourceDiagnostic.js";
import type { AgentSchemaValidationError } from "./AgentSchemaValidator.js";
import type { AgentProtocolErrorCode } from "./Xml/AgentXmlStatus.js";
import type { AgentPluginRegistry } from "./Plugin/AgentPluginRegistry.js";
import type { AgentPromptRenderer } from "./Prompt/AgentPromptRenderer.js";
import {
  AgentDefaultXmlProtocolSpec,
  type AgentXmlProtocolSpec,
} from "./Xml/AgentXmlPolicy.js";

type RepairPromptDiagnostic = {
  message: string;
  // Liquid strictVariables treats missing properties as errors even in conditionals.
  // Use nulls instead of undefined to keep the shape stable.
  pointer: string | null;
  position: { line: number; column: number } | null;
  frameText: string | null;
  suggestion: string | null;
};

export class AgentRetryDiagnostics {
  constructor(
    private readonly deps: {
      registry: AgentPluginRegistry;
      promptRenderer: AgentPromptRenderer;
      workspaceRoot: string;
      protocol?: AgentXmlProtocolSpec;
    },
  ) {}

  buildXmlRepairPrompt(
    code: AgentProtocolErrorCode,
    diagnostics: AgentSourceDiagnostic[],
    heading = "上一条 XML 决策没有通过解析或校验。",
  ): string {
    const template = this.deps.registry.getTemplate("RepairPrompt");
    if (!template) {
      // If the template isn't registered for any reason, fail loudly: the system can't
      // guide the model to self-heal without a stable prompt.
      throw new Error("RepairPrompt 模板没有注册。");
    }

    const rendered = this.deps.promptRenderer.renderFileSync(template.path, {
      heading,
      code,
      diagnostics: diagnostics.map(mapDiagnostic),
      ToolCallProtocol: this.readToolCallProtocol(),
    });

    // Liquid may preserve some leading/trailing whitespace; normalize for stable prompts.
    return rendered.trim();
  }

  private readToolCallProtocol(): {
    root: string;
    callTag: string;
    nameTag: string;
    argumentsTag: string;
    arrayItemTag: string;
  } {
    const action = this.deps.registry
      .listDecisionActions()
      .find((item) => item.kind === "ToolCalls");
    if (!action) {
      throw new Error("ToolCalls 决策动作没有注册。");
    }

    return {
      root: action.xmlRoot,
      callTag: this.deps.protocol?.items.toolCall ?? AgentDefaultXmlProtocolSpec.items.toolCall,
      nameTag: this.deps.protocol?.toolCall.name ?? AgentDefaultXmlProtocolSpec.toolCall.name,
      argumentsTag:
        this.deps.protocol?.toolCall.arguments
        ?? AgentDefaultXmlProtocolSpec.toolCall.arguments,
      arrayItemTag: this.deps.protocol?.items.arrayItem ?? AgentDefaultXmlProtocolSpec.items.arrayItem,
    };
  }
}

function mapDiagnostic(diagnostic: AgentSourceDiagnostic): RepairPromptDiagnostic {
  return {
    message: diagnostic.message,
    pointer: diagnostic.pointer ?? null,
    position: diagnostic.position ?? null,
    frameText: diagnostic.frame?.text ?? null,
    suggestion: diagnostic.suggestion ?? null,
  };
}

export function formatSchemaIssue(issue: AgentSchemaValidationError["issues"][number]): string {
  const pathText = issue.path.length > 0 ? `/${issue.path.join("/")}` : "<root>";
  if (issue.code === "invalid_type") {
    const expected = "expected" in issue ? String(issue.expected) : "未知类型";
    const received = "received" in issue ? String(issue.received) : "undefined";
    return `字段类型不匹配或缺失：${pathText}，期望 ${expected}，实际 ${received}。`;
  }

  if (issue.code === "unrecognized_keys") {
    const keys = "keys" in issue ? issue.keys.join(", ") : "未知字段";
    return `字段不允许：${pathText}，多余字段：${keys}。`;
  }

  return `${pathText}: ${issue.message}`;
}

export function suggestionForSchemaIssue(
  issue: AgentSchemaValidationError["issues"][number],
): string {
  const pathParts = issue.path.filter((part): part is string | number =>
    typeof part === "string" || typeof part === "number",
  );
  const last = pathParts[pathParts.length - 1];

  if (issue.code === "invalid_type" && last) {
    return `在定位到的 XML 位置内补充或修正 <${last}>...</${last}>。`;
  }

  if (issue.code === "unrecognized_keys") {
    return "删除未在工具参数 schema 中声明的 XML 子标签。";
  }

  return "按对应工具的 Zod 参数 schema 修正这个字段。";
}
