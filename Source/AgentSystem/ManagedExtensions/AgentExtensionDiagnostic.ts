import fs from "node:fs";
import path from "node:path";
import { structuredPatch } from "diff";
import { AgentJsonFileError, type AgentJsonDiagnostic } from "../Config/AgentJsonFileLoader.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { relativePathWithin } from "../Core/AgentPath.js";
import type { AgentSourceDiagnostic } from "../Diagnostics/AgentSourceDiagnostic.js";
import { agentJsonPointerToPath } from "../Diagnostics/AgentJsonPointer.js";

export interface AgentExtensionDiff {
  readonly previousFilePath: string;
  readonly candidateFilePath: string;
  readonly hunk: string;
}

export interface AgentExtensionDiagnostic extends AgentSourceDiagnostic {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
  readonly filePath?: string;
  readonly pointer?: string;
  readonly path?: readonly (string | number)[];
  readonly diff?: AgentExtensionDiff;
}

export function extensionDiagnosticsFromError(
  error: unknown,
  options: { code: string; fallbackFilePath?: string },
): AgentExtensionDiagnostic[] {
  if (error instanceof AgentJsonFileError) {
    return error.diagnostics.map((diagnostic) => fromJsonDiagnostic(diagnostic, options.code));
  }
  if (hasExtensionDiagnostics(error)) return [...error.diagnostics];
  return [
    {
      severity: "error",
      code: options.code,
      message: errorMessage(error),
      filePath: options.fallbackFilePath,
    },
  ];
}

function hasExtensionDiagnostics(error: unknown): error is { diagnostics: readonly AgentExtensionDiagnostic[] } {
  if (!error || typeof error !== "object" || !("diagnostics" in error) || !Array.isArray(error.diagnostics)) {
    return false;
  }
  return error.diagnostics.every(
    (diagnostic) =>
      diagnostic && typeof diagnostic === "object" && "message" in diagnostic && typeof diagnostic.message === "string",
  );
}

export function projectCandidateDiagnostics(
  diagnostics: readonly AgentExtensionDiagnostic[],
  input: { candidateRoot: string; reportedRoot: string; previousRoot?: string },
): AgentExtensionDiagnostic[] {
  return diagnostics.map((diagnostic) => {
    const relativePath = diagnostic.filePath ? relativePathWithin(input.candidateRoot, diagnostic.filePath) : undefined;
    const reportedFilePath = relativePath ? path.join(input.reportedRoot, relativePath) : diagnostic.filePath;
    const diff =
      relativePath && input.previousRoot && diagnostic.filePath
        ? buildExtensionDiff(
            path.join(input.previousRoot, relativePath),
            diagnostic.filePath,
            diagnostic.position?.line,
          )
        : undefined;
    return {
      ...diagnostic,
      filePath: reportedFilePath,
      diff,
    };
  });
}

function fromJsonDiagnostic(diagnostic: AgentJsonDiagnostic, code: string): AgentExtensionDiagnostic {
  return {
    severity: "error",
    code,
    message: diagnostic.message,
    filePath: diagnostic.filePath,
    pointer: diagnostic.pointer,
    path: diagnostic.pointer === undefined ? undefined : agentJsonPointerToPath(diagnostic.pointer),
    position: diagnostic.location,
    frame: diagnostic.frame,
  };
}

function buildExtensionDiff(
  previousFilePath: string,
  candidateFilePath: string,
  line: number | undefined,
): AgentExtensionDiff | undefined {
  if (!fs.existsSync(previousFilePath) || !fs.existsSync(candidateFilePath)) return undefined;
  const previous = fs.readFileSync(previousFilePath, "utf8");
  const candidate = fs.readFileSync(candidateFilePath, "utf8");
  if (previous === candidate) return undefined;
  const patch = structuredPatch(previousFilePath, candidateFilePath, previous, candidate);
  const hunk = line
    ? patch.hunks.find(
        (candidateHunk) => line >= candidateHunk.newStart && line < candidateHunk.newStart + candidateHunk.newLines,
      )
    : patch.hunks[0];
  if (!hunk) return undefined;
  return {
    previousFilePath,
    candidateFilePath,
    hunk: [`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`, ...hunk.lines].join("\n"),
  };
}
