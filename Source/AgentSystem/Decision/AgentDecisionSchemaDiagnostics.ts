import type { AgentSourceDiagnostic } from "../AgentSourceDiagnostic.js";
import {
  formatSchemaIssue,
  suggestionForSchemaIssue,
} from "../AgentRetryDiagnostics.js";
import type { AgentSchemaValidationError } from "../AgentSchemaValidator.js";
import type { AgentXmlSourceHelper } from "../Xml/AgentXmlParser.js";

export function buildDecisionSchemaDiagnostics(
  source: AgentXmlSourceHelper,
  rootName: string,
  prefixPath: Array<string | number>,
  issues: AgentSchemaValidationError["issues"],
): AgentSourceDiagnostic[] {
  return issues.map((issue) => {
    const issuePath = issue.path.filter((part): part is string | number =>
      typeof part === "string" || typeof part === "number");

    return source.diagnosticForPath(
      formatSchemaIssue(issue),
      rootName,
      [...prefixPath, ...issuePath],
      suggestionForSchemaIssue(issue),
    );
  });
}
