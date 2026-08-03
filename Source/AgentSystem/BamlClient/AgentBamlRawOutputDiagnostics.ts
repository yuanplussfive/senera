import parseJson from "json-parse-even-better-errors";
import jsonSourceMap, { type JsonSourceLocation } from "json-source-map";
import { AgentSourceDiagnosticBuilder, type AgentSourceDiagnostic } from "../Diagnostics/AgentSourceDiagnostic.js";
import { agentStructuredIssueToPointer, type AgentStructuredIssue } from "../Diagnostics/AgentStructuredIssue.js";

const RawOutputParseSuggestion = "输出一个合法 JSON 对象，不要包裹 Markdown、解释文本或额外前后缀。";
const RawOutputFieldSuggestion = "修复该字段，使 BAML 输出满足目标结构和语义校验。";

export interface AgentBamlRawOutputDiagnosticsInput {
  readonly rawOutput: string;
  readonly issues: readonly AgentStructuredIssue[];
}

export function buildBamlRawOutputDiagnostics(input: AgentBamlRawOutputDiagnosticsInput): AgentSourceDiagnostic[] {
  if (input.rawOutput.trim().length === 0) {
    return [];
  }

  const source = new AgentSourceDiagnosticBuilder(input.rawOutput);
  const mapped = parseJsonSourceMap(input.rawOutput);
  return mapped.ok
    ? diagnosticsFromMappedJson(source, mapped.value, input.issues)
    : [diagnosticFromJsonParseFailure(source, input.rawOutput, mapped.error)];
}

export function formatBamlRawOutputRepairIssues(options: {
  readonly issues: readonly string[];
  readonly diagnostics: readonly AgentSourceDiagnostic[];
}): string[] {
  if (options.diagnostics.length === 0) {
    return [...options.issues];
  }

  return options.diagnostics.map((diagnostic) => {
    const location = diagnostic.position
      ? `line ${diagnostic.position.line}, column ${diagnostic.position.column}`
      : "unknown location";
    const pointer = diagnostic.pointer ? `${diagnostic.pointer} ` : "";
    return `${pointer}${location}: ${diagnostic.message}`;
  });
}

function diagnosticsFromMappedJson(
  source: AgentSourceDiagnosticBuilder,
  mapped: ReturnType<typeof jsonSourceMap.parse>,
  issues: readonly AgentStructuredIssue[],
): AgentSourceDiagnostic[] {
  const targets =
    issues.length > 0 ? issues : ([{ message: "BAML 输出结构无效。", path: [] }] satisfies AgentStructuredIssue[]);

  return targets.map((issue) => {
    const pointer = agentStructuredIssueToPointer(issue);
    const location = findJsonSourceLocation(mapped, pointer);
    return location
      ? source.fromLineColumn(issue.message, location.line + 1, location.column + 1, {
          pointer,
          path: issue.path ? [...issue.path] : undefined,
          suggestion: RawOutputFieldSuggestion,
        })
      : {
          message: issue.message,
          pointer,
          path: issue.path ? [...issue.path] : undefined,
          suggestion: RawOutputFieldSuggestion,
        };
  });
}

function findJsonSourceLocation(
  mapped: ReturnType<typeof jsonSourceMap.parse>,
  pointer: string,
): JsonSourceLocation | undefined {
  const entry = mapped.pointers[pointer] ?? mapped.pointers[""];
  return entry?.value ?? entry?.key;
}

function parseJsonSourceMap(
  rawOutput: string,
):
  | { readonly ok: true; readonly value: ReturnType<typeof jsonSourceMap.parse> }
  | { readonly ok: false; readonly error: unknown } {
  try {
    return {
      ok: true,
      value: jsonSourceMap.parse(rawOutput),
    };
  } catch (error) {
    return {
      ok: false,
      error,
    };
  }
}

function diagnosticFromJsonParseFailure(
  source: AgentSourceDiagnosticBuilder,
  rawOutput: string,
  sourceMapError: unknown,
): AgentSourceDiagnostic {
  try {
    parseJson(rawOutput);
  } catch (error) {
    const parseError = error as Error & { position?: number };
    return typeof parseError.position === "number"
      ? source.fromPosition(parseError.message, parseError.position, {
          pointer: "/",
          path: [],
          suggestion: RawOutputParseSuggestion,
        })
      : {
          message: parseError.message,
          pointer: "/",
          path: [],
          suggestion: RawOutputParseSuggestion,
        };
  }

  return {
    message: sourceMapError instanceof Error ? sourceMapError.message : "BAML raw output JSON source map 构建失败。",
    pointer: "/",
    path: [],
    suggestion: RawOutputParseSuggestion,
  };
}
