import type { AgentSourceDiagnostic } from "../Diagnostics/AgentSourceDiagnostic.js";
import type { AgentXmlProtocolSpec } from "../Xml/AgentXmlPolicy.js";
import type { AgentXmlSourceHelper } from "../Xml/AgentXmlParser.js";

export function toolCallPath(
  protocol: AgentXmlProtocolSpec,
  callIndex: number,
  ...path: Array<string | number>
): Array<string | number> {
  return [protocol.items.toolCall, callIndex, ...path];
}

export function remapToolDiagnostics(
  source: AgentXmlSourceHelper,
  rootName: string,
  basePath: Array<string | number>,
  diagnostics: AgentSourceDiagnostic[] | undefined,
  fallbackMessage: string,
): AgentSourceDiagnostic[] {
  return diagnostics && diagnostics.length > 0
    ? diagnostics.map((diagnostic) =>
        source.diagnosticForPath(
          diagnostic.message,
          rootName,
          [...basePath, ...(diagnostic.path ?? [])],
          diagnostic.suggestion,
        ))
    : [
        source.diagnosticForPath(
          fallbackMessage,
          rootName,
          basePath,
          "修正这个工具调用的参数或前置条件，然后重新输出 XML 决策。",
        ),
      ];
}
