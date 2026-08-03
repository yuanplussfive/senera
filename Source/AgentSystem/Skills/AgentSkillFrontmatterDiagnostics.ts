import { LineCounter, parseDocument } from "yaml";
import type { z } from "zod";
import { AgentSourceDiagnosticBuilder } from "../Diagnostics/AgentSourceDiagnostic.js";
import type { AgentExtensionDiagnostic } from "../ManagedExtensions/AgentExtensionDiagnostic.js";
import { parseAgentSkillDocument } from "./AgentSkillDocument.js";

export function agentSkillFrontmatterIssueDiagnostics(
  source: string,
  filePath: string,
  issues: readonly z.ZodIssue[],
  code: string,
): AgentExtensionDiagnostic[] {
  return issues.map((issue) =>
    agentSkillFrontmatterDiagnostic(
      source,
      filePath,
      issue.path.map((entry) => (typeof entry === "number" ? entry : String(entry))),
      issue.message,
      code,
    ),
  );
}

export function agentSkillFrontmatterDiagnostic(
  source: string,
  filePath: string,
  pathParts: readonly (string | number)[],
  message: string,
  code: string,
): AgentExtensionDiagnostic {
  const document = parseAgentSkillDocument(source);
  const lineCounter = new LineCounter();
  const yamlDocument = parseDocument(document.matter, { lineCounter });
  const node = yamlDocument.getIn(pathParts, true);
  const matterOffset = source.indexOf(document.matter);
  const offset = sourceNodeOffset(node);
  const pointer = jsonPointer(pathParts);
  const builder = new AgentSourceDiagnosticBuilder(source);
  const location = builder.fromPosition(message, matterOffset + (offset ?? 0), {
    pointer,
    path: [...pathParts],
  });
  return {
    ...location,
    severity: "error",
    code,
    filePath,
  };
}

function sourceNodeOffset(node: unknown): number | undefined {
  if (!node || typeof node !== "object" || !("range" in node) || !Array.isArray(node.range)) return undefined;
  const [offset] = node.range;
  return typeof offset === "number" ? offset : undefined;
}

function jsonPointer(pathParts: readonly (string | number)[]): string {
  return pathParts.length === 0
    ? ""
    : `/${pathParts.map((part) => String(part).replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
}
