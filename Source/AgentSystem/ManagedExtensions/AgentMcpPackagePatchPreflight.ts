import { AgentMcpPackageScanner, assertUniqueAgentMcpServerNames } from "../McpPackages/AgentMcpPackageScanner.js";
import { AgentMcpPackageSourceKinds } from "../McpPackages/AgentMcpPackageTypes.js";
import { createAgentMcpPackageEndpoint } from "../McpPackages/AgentMcpPackageRuntime.js";
import { resolveAgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";
import { relativePathWithin } from "../Core/AgentPath.js";
import { extensionDiagnosticsFromError, projectCandidateDiagnostics } from "./AgentExtensionDiagnostic.js";
import {
  AgentExtensionPatchPreflightError,
  changedAgentExtensionNames,
  stageAgentExtensionCandidate,
  type AgentExtensionPatchCandidate,
  type AgentExtensionPatchPlan,
  type AgentExtensionPatchValidation,
} from "./AgentExtensionPatchCandidate.js";
import { resolveManagedExtensionDirectory } from "./AgentManagedExtensionPaths.js";
import type { AgentExtensionValueResolver } from "../Extensions/AgentExtensionValueExpression.js";

const PreflightMcpInputResolver: AgentExtensionValueResolver = {
  resolve(_serverId, binding) {
    if (binding.source === "runtime" || binding.source === "oauth") return undefined;
    return { value: "senera-preflight-value", source: binding.source === "config" ? "configuration" : "environment" };
  },
};

export class AgentMcpPackagePatchPreflight {
  private readonly mcpRoot: string;
  private readonly scanner = new AgentMcpPackageScanner();

  constructor(private readonly workspaceRoot: string) {
    this.mcpRoot = resolveAgentWorkspaceLayout(workspaceRoot).mcpRoot;
  }

  validate(plan: AgentExtensionPatchPlan, changedPaths: readonly string[]): AgentExtensionPatchValidation[] {
    const names = [...changedAgentExtensionNames(this.workspaceRoot, this.mcpRoot, changedPaths)].sort((left, right) =>
      left.localeCompare(right),
    );
    if (names.length === 0) return [];

    const changedNames = new Set(names);
    const candidates: AgentExtensionPatchCandidate[] = [];
    let activeName = names[0]!;
    try {
      for (const name of names) {
        activeName = name;
        candidates.push(
          stageAgentExtensionCandidate({
            workspaceRoot: this.workspaceRoot,
            collectionRoot: this.mcpRoot,
            name,
            plan,
          }),
        );
      }

      const packages = [
        ...this.scanner.scanRoot(this.mcpRoot, AgentMcpPackageSourceKinds.Workspace, {
          excludeNames: changedNames,
        }),
        ...candidates.flatMap((candidate) =>
          candidate.exists
            ? [this.scanner.readPackage(candidate.candidatePath, AgentMcpPackageSourceKinds.Workspace, candidate.name)]
            : [],
        ),
      ];
      assertUniqueAgentMcpServerNames(packages);
      for (const package_ of packages) {
        for (const server of package_.servers) {
          createAgentMcpPackageEndpoint(package_, server, PreflightMcpInputResolver, this.workspaceRoot);
        }
      }
      return candidates.flatMap((candidate) =>
        candidate.exists
          ? [{ kind: "MCP" as const, name: candidate.name, path: candidate.sourcePath, status: "validated" as const }]
          : [],
      );
    } catch (error) {
      const rawDiagnostics = extensionDiagnosticsFromError(error, {
        code: "mcp.package.patch.preflight",
        fallbackFilePath: resolveManagedExtensionDirectory(this.mcpRoot, activeName),
      });
      const candidate =
        candidateForDiagnostics(candidates, rawDiagnostics) ?? candidates.find((entry) => entry.name === activeName);
      const diagnostics = candidate
        ? projectCandidateDiagnostics(rawDiagnostics, {
            candidateRoot: candidate.candidatePath,
            reportedRoot: candidate.sourcePath,
            previousRoot: candidate.previousExists ? candidate.sourcePath : undefined,
          })
        : rawDiagnostics;
      throw new AgentExtensionPatchPreflightError("MCP", candidate?.name ?? activeName, diagnostics);
    } finally {
      for (const candidate of candidates) candidate.dispose();
    }
  }
}

function candidateForDiagnostics(
  candidates: readonly AgentExtensionPatchCandidate[],
  diagnostics: readonly { filePath?: string }[],
): AgentExtensionPatchCandidate | undefined {
  return candidates.find((candidate) =>
    diagnostics.some(
      (diagnostic) =>
        diagnostic.filePath !== undefined &&
        relativePathWithin(candidate.candidatePath, diagnostic.filePath) !== undefined,
    ),
  );
}
