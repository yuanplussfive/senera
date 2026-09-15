import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeFileAtomicSync } from "../Core/AgentFs.js";
import { relativePathWithin } from "../Core/AgentPath.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";
import type { AgentExtensionDiagnostic } from "./AgentExtensionDiagnostic.js";
import { resolveManagedExtensionDirectory } from "./AgentManagedExtensionPaths.js";

interface ExtensionPatchTarget {
  readonly relativePath: string;
}

export interface AgentExtensionPatchPlan {
  readonly writes: ReadonlyMap<string, { readonly target: ExtensionPatchTarget; readonly content: string }>;
  readonly deletes: ReadonlyMap<string, { readonly target: ExtensionPatchTarget }>;
  readonly createDirectories: ReadonlyMap<string, { readonly target: ExtensionPatchTarget }>;
  readonly deleteDirectories: ReadonlyMap<
    string,
    { readonly target: ExtensionPatchTarget; readonly recursive: boolean }
  >;
}

export interface AgentExtensionPatchValidation {
  readonly kind: "Skill" | "MCP";
  readonly name: string;
  readonly path: string;
  readonly status: "validated";
}

export class AgentExtensionPatchPreflightError extends AgentBaseError {
  constructor(
    readonly extensionKind: AgentExtensionPatchValidation["kind"],
    readonly extensionName: string,
    readonly diagnostics: readonly AgentExtensionDiagnostic[],
  ) {
    super(`${extensionKind} ${extensionName} failed preflight validation.`);
  }
}

export interface AgentExtensionPatchCandidate {
  readonly name: string;
  readonly sourcePath: string;
  readonly candidatePath: string;
  readonly previousExists: boolean;
  readonly exists: boolean;
  dispose(): void;
}

export function changedAgentExtensionNames(
  workspaceRoot: string,
  collectionRoot: string,
  changedPaths: readonly string[],
): ReadonlySet<string> {
  const names = new Set<string>();
  for (const changedPath of changedPaths) {
    const relative = relativePathWithin(collectionRoot, path.resolve(workspaceRoot, changedPath));
    const name = relative?.split(path.sep).filter(Boolean)[0];
    if (name) names.add(name);
  }
  return names;
}

export function stageAgentExtensionCandidate(input: {
  workspaceRoot: string;
  collectionRoot: string;
  name: string;
  plan: AgentExtensionPatchPlan;
}): AgentExtensionPatchCandidate {
  const sourcePath = resolveManagedExtensionDirectory(input.collectionRoot, input.name);
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-extension-preflight-"));
  const candidatePath = path.join(stagingRoot, input.name);
  const previousExists = fs.existsSync(sourcePath);
  try {
    if (previousExists) fs.cpSync(sourcePath, candidatePath, { recursive: true, errorOnExist: true, force: false });
    materializeCandidate(input.plan, input.workspaceRoot, sourcePath, candidatePath);
    return {
      name: input.name,
      sourcePath,
      candidatePath,
      previousExists,
      exists: fs.existsSync(candidatePath),
      dispose: () => fs.rmSync(stagingRoot, { recursive: true, force: true }),
    };
  } catch (error) {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

function materializeCandidate(
  plan: AgentExtensionPatchPlan,
  workspaceRoot: string,
  sourcePath: string,
  candidatePath: string,
): void {
  for (const directory of plan.createDirectories.values()) {
    const target = projectCandidatePath(workspaceRoot, sourcePath, candidatePath, directory.target.relativePath);
    if (target) fs.mkdirSync(target, { recursive: true });
  }
  for (const write of plan.writes.values()) {
    const target = projectCandidatePath(workspaceRoot, sourcePath, candidatePath, write.target.relativePath);
    if (target) writeFileAtomicSync(target, write.content);
  }
  for (const deletion of plan.deletes.values()) {
    const target = projectCandidatePath(workspaceRoot, sourcePath, candidatePath, deletion.target.relativePath);
    if (target) fs.rmSync(target);
  }
  for (const deletion of plan.deleteDirectories.values()) {
    const target = projectCandidatePath(workspaceRoot, sourcePath, candidatePath, deletion.target.relativePath);
    if (target) fs.rmSync(target, { recursive: deletion.recursive });
  }
}

function projectCandidatePath(
  workspaceRoot: string,
  sourcePath: string,
  candidatePath: string,
  relativePath: string,
): string | undefined {
  const relative = relativePathWithin(sourcePath, path.resolve(workspaceRoot, relativePath));
  return relative === undefined ? undefined : path.join(candidatePath, relative);
}
