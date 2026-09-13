import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { errorMessage } from "../Core/AgentErrors.js";
import { writeFileAtomicSync } from "../Core/AgentFs.js";
import { assertAgentExtensionName } from "../Extensions/AgentExtensionIdentity.js";
import { AgentSkillScanner } from "../Skills/AgentSkillScanner.js";
import type { AgentSkillResourceDescriptor } from "../Skills/AgentSkillScanner.js";
import { AgentSkillSelector } from "../Skills/AgentSkillSelector.js";
import { isAgentSkillModelInvocable } from "../Skills/AgentSkillInvocation.js";
import type { RegisteredSkill } from "../Skills/AgentSkillTypes.js";
import { AgentSkillValidationError } from "../Skills/AgentSkillValidationError.js";
import type {
  AgentSelfSkillCheckReport,
  AgentSelfSkillHistoryEntry,
  AgentSelfSkillInspection,
  AgentSelfSkillMutationResult,
  AgentSelfSkillSource,
  AgentSelfSkillSummary,
  AgentSelfSkillDiff,
  AgentSelfSkillDiffEntry,
  AgentSelfSkillResourceListing,
  AgentSelfSkillResourceRead,
  AgentSelfSkillSearchMatch,
  AgentSelfServicePort,
} from "./AgentSelfServiceTypes.js";

const SkillHistoryDirectoryName = ".skill-history";
const SkillHistoryMetadataFileName = ".senera-skill-history.json";
const SkillDocumentFileName = "SKILL.md";
const MaxSkillDocumentBytes = 1_024 * 1_024;
const DefaultSkillSearchLimit = 8;
const MaxSkillSearchLimit = 12;

/**
 * Skill inventory and workspace mutation adapter for the self-service surface.
 * The scanner remains the single frontmatter validator; this adapter adds
 * source identity, revision history and bounded diagnostics without allowing
 * arbitrary paths from the model.
 */
export function createAgentSelfSkillsPort(
  sources: readonly AgentSelfSkillSource[],
): NonNullable<AgentSelfServicePort["skills"]> {
  const normalized = sources.map((source) => ({ ...source, root: path.resolve(source.root) }));
  const scanner = new AgentSkillScanner();

  return {
    list: () => projectSkillConflicts(scanSources(normalized, scanner).flatMap((snapshot) => snapshot.skills)),
    search: (query, limit) => searchSkills(normalized, scanner, query, limit),
    inspect: (name) => inspectSkill(normalized, scanner, name),
    resources: (name) => listSkillResources(normalized, scanner, name),
    readResource: (name, relativePath, expectedRevision) =>
      readSkillResource(normalized, scanner, name, relativePath, expectedRevision),
    diff: (name, revision) => diffSkillRevision(normalized, scanner, name, revision),
    check: (name) => checkSkills(normalized, scanner, name),
    create: (name, content) => mutateWorkspaceSkill(normalized, scanner, "create", name, content),
    update: (name, content, expectedRevision) =>
      mutateWorkspaceSkill(normalized, scanner, "update", name, content, expectedRevision),
    archive: (name, expectedRevision) => archiveWorkspaceSkill(normalized, scanner, name, expectedRevision),
    restore: (name, revision) => restoreWorkspaceSkill(normalized, scanner, name, revision),
    history: (name) => readWorkspaceSkillHistory(normalized, name),
  };
}

function searchSkills(
  sources: readonly AgentSelfSkillSource[],
  scanner: AgentSkillScanner,
  query: string,
  limit = DefaultSkillSearchLimit,
): AgentSelfSkillSearchMatch[] {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];

  const projected = projectSkillConflicts(scanSources(sources, scanner).flatMap((snapshot) => snapshot.skills));
  const validByFile = new Map(
    projected.filter((skill) => skill.valid).map((skill) => [path.resolve(skill.descriptionFile), skill]),
  );
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const registered: RegisteredSkill[] = [];
  for (const summary of validByFile.values()) {
    const source = sourceById.get(summary.source.id);
    if (!source) continue;
    try {
      const parsed = scanner.readSkillDirectory(path.dirname(summary.descriptionFile), summary.name);
      if (parsed.revision !== summary.revision) continue;
      registered.push({
        ...parsed,
        source: {
          kind: source.kind === "system" ? "system" : "standalone",
          id: source.id,
          displayName: source.displayName,
        },
      });
    } catch {
      // The inventory remains the authority for validation. A concurrent
      // mutation between the two reads simply removes this candidate from
      // the bounded result rather than selecting stale content.
    }
  }

  const selected = new AgentSkillSelector().select({
    query: normalizedQuery,
    skills: registered.filter(isAgentSkillModelInvocable),
  });
  const summaryByFile = new Map(
    [...validByFile.values()].map((summary) => [path.resolve(summary.descriptionFile), summary]),
  );
  const boundedLimit = normalizeSkillSearchLimit(limit);
  return selected.slice(0, boundedLimit).flatMap((match) => {
    const summary = summaryByFile.get(path.resolve(match.skill.descriptionFile));
    return summary
      ? [
          {
            skill: summary,
            score: match.score,
            matchedTerms: [...match.matchedTerms],
            matchedFields: match.matchedFields.map((field) => ({ term: field.term, fields: [...field.fields] })),
          },
        ]
      : [];
  });
}

function normalizeSkillSearchLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit <= 0) return DefaultSkillSearchLimit;
  return Math.min(limit, MaxSkillSearchLimit);
}

interface SkillSourceSnapshot {
  readonly source: AgentSelfSkillSource;
  readonly skills: readonly AgentSelfSkillSummary[];
  readonly issues: readonly string[];
}

function scanSources(sources: readonly AgentSelfSkillSource[], scanner: AgentSkillScanner): SkillSourceSnapshot[] {
  return sources.map((source) => scanSource(source, scanner));
}

function scanSource(source: AgentSelfSkillSource, scanner: AgentSkillScanner): SkillSourceSnapshot {
  if (!fs.existsSync(source.root)) {
    return { source, skills: [], issues: [`Skill 来源目录不存在: ${source.displayName} (${source.root})`] };
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(source.root, { withFileTypes: true });
  } catch (error) {
    return { source, skills: [], issues: [`无法读取 Skill 来源 ${source.displayName}: ${errorMessage(error)}`] };
  }

  const skills: AgentSelfSkillSummary[] = [];
  const issues: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name.startsWith(".") || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const skillRoot = path.join(source.root, entry.name);
    const descriptionFile = path.join(skillRoot, "SKILL.md");
    try {
      const skill = scanner.readSkillDirectory(skillRoot, entry.name);
      const resources = scanner.listResources(skillRoot);
      skills.push({
        name: skill.name,
        description: skill.description,
        descriptionFile: skill.descriptionFile,
        source: { id: source.id, displayName: source.displayName, kind: source.kind },
        revision: skill.revision,
        recommendedTools: [...skill.recommendedTools],
        ...(skill.disableModelInvocation === true ? { disableModelInvocation: true } : {}),
        valid: true,
        issues: [],
        resourceCount: resources.length,
      });
    } catch (error) {
      const issue = errorMessage(error);
      const invalid: AgentSelfSkillSummary = {
        name: entry.name,
        description: "",
        descriptionFile,
        source: { id: source.id, displayName: source.displayName, kind: source.kind },
        recommendedTools: [],
        valid: false,
        issues: [issue],
        resourceCount: 0,
      };
      skills.push(invalid);
      issues.push(`${source.displayName}/${entry.name}: ${issue}`);
    }
  }
  return { source, skills, issues };
}

function inspectSkill(
  sources: readonly AgentSelfSkillSource[],
  scanner: AgentSkillScanner,
  name: string,
): AgentSelfSkillInspection {
  const requested = name.trim();
  if (!requested) return { status: "missing", error: "Skill 名称不能为空。" };

  const candidates = scanSources(sources, scanner)
    .flatMap((snapshot) => snapshot.skills)
    .filter((skill) => skill.name === requested);
  if (candidates.length === 0) return { status: "missing", error: `Skill 不存在: ${requested}` };
  if (candidates.length > 1) {
    return {
      status: "ambiguous",
      error: `Skill 名称存在多个来源: ${requested}；请先处理来源冲突。`,
      candidates,
    };
  }

  const skill = candidates[0]!;
  try {
    const skillRoot = path.dirname(skill.descriptionFile);
    return {
      status: "found",
      skill,
      content: fs.readFileSync(skill.descriptionFile, "utf8"),
      resources: scanner.listResources(skillRoot),
    };
  } catch (error) {
    return { status: "found", skill: { ...skill, valid: false, issues: [errorMessage(error)] }, content: "" };
  }
}

function listSkillResources(
  sources: readonly AgentSelfSkillSource[],
  scanner: AgentSkillScanner,
  name: string,
): AgentSelfSkillResourceListing {
  const resolved = resolveSkillReadTarget(sources, scanner, name);
  if (resolved.status !== "found") return resolved;
  return {
    status: "found",
    skill: { ...resolved.skill, resourceCount: resolved.resources.length },
    resources: resolved.resources,
  };
}

function readSkillResource(
  sources: readonly AgentSelfSkillSource[],
  scanner: AgentSkillScanner,
  name: string,
  relativePath: string,
  expectedRevision?: string,
): AgentSelfSkillResourceRead {
  const resolved = resolveSkillReadTarget(sources, scanner, name);
  if (resolved.status !== "found") return resolved;
  const observedRevision = AgentSkillScanner.sourceRevision(resolved.skillRoot);
  if (expectedRevision && expectedRevision !== observedRevision) {
    return { status: "stale", expectedRevision, actualRevision: observedRevision };
  }
  try {
    const resource = scanner.readResource(resolved.skillRoot, relativePath);
    const finalRevision = AgentSkillScanner.sourceRevision(resolved.skillRoot);
    if (finalRevision !== observedRevision) {
      return { status: "stale", expectedRevision: observedRevision, actualRevision: finalRevision };
    }
    return {
      status: "found",
      skill: resolved.skill,
      revision: finalRevision,
      resource,
    };
  } catch (error) {
    return { status: "invalid", error: errorMessage(error), skill: resolved.skill };
  }
}

function resolveSkillReadTarget(
  sources: readonly AgentSelfSkillSource[],
  scanner: AgentSkillScanner,
  name: string,
):
  | {
      readonly status: "found";
      readonly skill: AgentSelfSkillSummary;
      readonly skillRoot: string;
      readonly resources: readonly AgentSkillResourceDescriptor[];
    }
  | { readonly status: "missing"; readonly error: string }
  | { readonly status: "ambiguous"; readonly error: string; readonly candidates: readonly AgentSelfSkillSummary[] }
  | { readonly status: "invalid"; readonly error: string; readonly skill: AgentSelfSkillSummary } {
  const requested = name.trim();
  if (!requested) return { status: "missing", error: "Skill 名称不能为空。" };
  const candidates = scanSources(sources, scanner)
    .flatMap((snapshot) => snapshot.skills)
    .filter((skill) => skill.name === requested);
  if (candidates.length === 0) return { status: "missing", error: `Skill 不存在: ${requested}` };
  if (candidates.length > 1) {
    return {
      status: "ambiguous",
      error: `Skill 名称存在多个来源: ${requested}；请先处理来源冲突。`,
      candidates,
    };
  }
  const skill = candidates[0]!;
  try {
    const skillRoot = path.dirname(skill.descriptionFile);
    return { status: "found", skill, skillRoot, resources: scanner.listResources(skillRoot) };
  } catch (error) {
    return { status: "invalid", error: errorMessage(error), skill };
  }
}

function diffSkillRevision(
  sources: readonly AgentSelfSkillSource[],
  scanner: AgentSkillScanner,
  name: string,
  revision: string,
): AgentSelfSkillDiff {
  const resolved = resolveSkillReadTarget(sources, scanner, name);
  if (resolved.status !== "found") return resolved;
  const normalizedRevision = revision.trim();
  const context = resolveWorkspaceSkillContext(sources);
  if ("reason" in context) return { status: "missing", error: context.reason };
  const archive = path.join(context.historyRoot, resolved.skill.name, normalizedRevision);
  if (!fs.existsSync(archive)) return { status: "missing", error: `Skill revision 不存在: ${normalizedRevision}` };
  try {
    const before = scanner.listResources(archive);
    const after = resolved.resources;
    return {
      status: "found",
      skill: resolved.skill,
      currentRevision: resolved.skill.revision ?? "",
      comparedRevision: normalizedRevision,
      entries: projectSkillResourceDiff(before, after),
    };
  } catch (error) {
    return { status: "invalid", error: errorMessage(error), skill: resolved.skill };
  }
}

function projectSkillResourceDiff(
  before: readonly AgentSkillResourceDescriptor[],
  after: readonly AgentSkillResourceDescriptor[],
): AgentSelfSkillDiffEntry[] {
  const beforeByPath = new Map(before.map((entry) => [entry.relativePath, entry]));
  const afterByPath = new Map(after.map((entry) => [entry.relativePath, entry]));
  const paths = [...new Set([...beforeByPath.keys(), ...afterByPath.keys()])].sort();
  return paths.map((relativePath) => {
    const previous = beforeByPath.get(relativePath);
    const current = afterByPath.get(relativePath);
    if (!previous && current) return { path: relativePath, kind: "added" as const, after: current };
    if (previous && !current) return { path: relativePath, kind: "removed" as const, before: previous };
    if (previous?.digest === current?.digest) {
      return { path: relativePath, kind: "unchanged" as const, before: previous, after: current };
    }
    return { path: relativePath, kind: "changed" as const, before: previous, after: current };
  });
}

function checkSkills(
  sources: readonly AgentSelfSkillSource[],
  scanner: AgentSkillScanner,
  name?: string,
): AgentSelfSkillCheckReport {
  const snapshots = scanSources(sources, scanner);
  const skills = projectSkillConflicts(
    snapshots.flatMap((snapshot) => snapshot.skills).filter((skill) => !name || skill.name === name.trim()),
  );
  const sourceIssues = name ? [] : snapshots.flatMap((snapshot) => snapshot.issues);
  const issues = [
    ...sourceIssues,
    ...skills.flatMap((skill) => skill.issues.map((issue) => `${skill.name}: ${issue}`)),
  ];
  if (name && skills.length === 0 && sourceIssues.length === 0) issues.push(`Skill 不存在: ${name.trim()}`);
  return {
    checkedAt: new Date().toISOString(),
    valid: issues.length === 0,
    skills,
    issues,
  };
}

function projectSkillConflicts(skills: readonly AgentSelfSkillSummary[]): AgentSelfSkillSummary[] {
  const counts = new Map<string, number>();
  for (const skill of skills) counts.set(skill.name, (counts.get(skill.name) ?? 0) + 1);
  return skills.map((skill) => {
    if ((counts.get(skill.name) ?? 0) < 2) return skill;
    const issue = "同名 Skill 存在多个注册来源。";
    return {
      ...skill,
      valid: false,
      issues: skill.issues.includes(issue) ? skill.issues : [...skill.issues, issue],
    };
  });
}

type WorkspaceSkillMutation = "create" | "update";

interface WorkspaceSkillContext {
  readonly source: AgentSelfSkillSource;
  readonly root: string;
  readonly historyRoot: string;
}

interface WorkspaceSkillRead {
  readonly summary: AgentSelfSkillSummary;
  readonly content: string;
}

type WorkspaceSkillTargetResolution =
  | { readonly status: "resolved"; readonly context: WorkspaceSkillContext; readonly name: string }
  | { readonly status: "error"; readonly result: AgentSelfSkillMutationResult };

function mutateWorkspaceSkill(
  sources: readonly AgentSelfSkillSource[],
  scanner: AgentSkillScanner,
  operation: WorkspaceSkillMutation,
  requestedName: string,
  content: string,
  expectedRevision?: string,
): AgentSelfSkillMutationResult {
  const target = resolveWorkspaceSkillTarget(sources, requestedName);
  if (target.status === "error") return target.result;
  const { context, name } = target;
  const contentIssue = validateSkillContent(content);
  if (contentIssue) return { status: "invalid", name, issues: [contentIssue] };
  const activePath = resolveSkillPath(context.root, name);
  const current = readWorkspaceSkill(context, scanner, name);

  if (operation === "create") {
    if (current.status === "found") return { status: "exists", name, revision: current.value.summary.revision };
    if (current.status === "invalid") return { status: "invalid", name, issues: current.issues };
    return createWorkspaceSkill(context, scanner, name, content, activePath);
  }

  if (current.status === "missing") return { status: "missing", name };
  if (current.status === "invalid") return { status: "invalid", name, issues: current.issues };
  const currentRevision = current.value.summary.revision;
  if (expectedRevision && expectedRevision !== currentRevision) {
    return { status: "conflict", name, expectedRevision, actualRevision: currentRevision };
  }
  return updateWorkspaceSkill(context, scanner, name, content, activePath, current.value);
}

function createWorkspaceSkill(
  context: WorkspaceSkillContext,
  scanner: AgentSkillScanner,
  name: string,
  content: string,
  activePath: string,
): AgentSelfSkillMutationResult {
  const stagingPath = path.join(context.root, `.${name}.pending-${randomUUID()}`);
  try {
    fs.mkdirSync(stagingPath, { recursive: true });
    writeFileAtomicSync(path.join(stagingPath, SkillDocumentFileName), content, { directoryMode: 0o700, fsync: true });
    readSkillDirectorySummary(context.source, scanner, stagingPath, name);
    if (fs.existsSync(activePath)) return { status: "exists", name };
    fs.renameSync(stagingPath, activePath);
    const committed = readSkillDirectorySummary(context.source, scanner, activePath, name);
    return { status: "created", skill: committed, revision: committed.revision ?? "" };
  } catch (error) {
    return projectMutationError(name, error);
  } finally {
    removeStagingPath(stagingPath);
  }
}

function updateWorkspaceSkill(
  context: WorkspaceSkillContext,
  scanner: AgentSkillScanner,
  name: string,
  content: string,
  activePath: string,
  current: WorkspaceSkillRead,
): AgentSelfSkillMutationResult {
  const previousRevision = current.summary.revision;
  const historyPath = writeHistorySnapshot(context, activePath, name, previousRevision ?? "", "update");
  const documentPath = path.join(activePath, SkillDocumentFileName);
  const previousContent = current.content;
  try {
    writeFileAtomicSync(documentPath, content, { directoryMode: 0o700, fsync: true });
    const committed = readSkillDirectorySummary(context.source, scanner, activePath, name);
    return {
      status: "updated",
      skill: committed,
      revision: committed.revision ?? "",
      ...(previousRevision ? { previousRevision } : {}),
    };
  } catch (error) {
    try {
      writeFileAtomicSync(documentPath, previousContent, { directoryMode: 0o700, fsync: true });
    } catch (restoreError) {
      throw new Error(`Skill 更新失败且无法恢复原文: ${errorMessage(error)}; ${errorMessage(restoreError)}`, {
        cause: restoreError,
      });
    }
    removeHistorySnapshot(historyPath);
    return projectMutationError(name, error);
  }
}

function archiveWorkspaceSkill(
  sources: readonly AgentSelfSkillSource[],
  scanner: AgentSkillScanner,
  requestedName: string,
  expectedRevision?: string,
): AgentSelfSkillMutationResult {
  const target = resolveWorkspaceSkillTarget(sources, requestedName);
  if (target.status === "error") return target.result;
  const { context, name } = target;
  const activePath = resolveSkillPath(context.root, name);
  const current = readWorkspaceSkill(context, scanner, name);
  if (current.status === "missing") return { status: "missing", name };
  if (current.status === "invalid") return { status: "invalid", name, issues: current.issues };
  const revision = current.value.summary.revision ?? "";
  if (expectedRevision && expectedRevision !== revision) {
    return { status: "conflict", name, expectedRevision, actualRevision: revision };
  }

  const archiveParent = path.join(context.historyRoot, name);
  const finalPath = path.join(archiveParent, revision);
  if (fs.existsSync(finalPath)) return { status: "exists", name, revision };
  fs.mkdirSync(archiveParent, { recursive: true, mode: 0o700 });
  const stagingPath = path.join(archiveParent, `.${revision}.${randomUUID()}.pending`);
  try {
    fs.renameSync(activePath, stagingPath);
    writeHistoryMetadata(stagingPath, {
      revision,
      action: "archive",
      createdAt: new Date().toISOString(),
      sourceRevision: revision,
    });
    fs.renameSync(stagingPath, finalPath);
    return { status: "archived", name, revision };
  } catch (error) {
    if (!fs.existsSync(activePath) && fs.existsSync(stagingPath)) {
      try {
        fs.renameSync(stagingPath, activePath);
      } catch (restoreError) {
        throw new Error(`Skill 归档失败且无法恢复活动目录: ${errorMessage(error)}; ${errorMessage(restoreError)}`, {
          cause: restoreError,
        });
      }
    }
    return projectMutationError(name, error);
  } finally {
    removeStagingPath(stagingPath);
  }
}

function restoreWorkspaceSkill(
  sources: readonly AgentSelfSkillSource[],
  scanner: AgentSkillScanner,
  requestedName: string,
  revision: string,
): AgentSelfSkillMutationResult {
  const target = resolveWorkspaceSkillTarget(sources, requestedName);
  if (target.status === "error") return target.result;
  const { context, name } = target;
  const normalizedRevision = revision.trim();
  if (!/^[a-f0-9]{16,128}$/u.test(normalizedRevision)) {
    return { status: "invalid", name, issues: ["Skill revision 必须是内容摘要。"] };
  }
  const activePath = resolveSkillPath(context.root, name);
  if (fs.existsSync(activePath)) {
    const current = readWorkspaceSkill(context, scanner, name);
    return {
      status: "exists",
      name,
      ...(current.status === "found" && current.value.summary.revision
        ? { revision: current.value.summary.revision }
        : {}),
    };
  }
  const snapshotPath = path.join(context.historyRoot, name, normalizedRevision);
  if (!fs.existsSync(snapshotPath)) return { status: "missing", name };
  const stagingPath = path.join(context.root, `.${name}.restore-${randomUUID()}`);
  try {
    fs.cpSync(snapshotPath, stagingPath, { recursive: true, force: false });
    fs.rmSync(path.join(stagingPath, SkillHistoryMetadataFileName), { force: true });
    readSkillDirectorySummary(context.source, scanner, stagingPath, name);
    fs.renameSync(stagingPath, activePath);
    const committed = readSkillDirectorySummary(context.source, scanner, activePath, name);
    return {
      status: "restored",
      skill: committed,
      revision: committed.revision ?? "",
      restoredFrom: normalizedRevision,
    };
  } catch (error) {
    return projectMutationError(name, error);
  } finally {
    removeStagingPath(stagingPath);
  }
}

function resolveWorkspaceSkillTarget(
  sources: readonly AgentSelfSkillSource[],
  requestedName: string,
): WorkspaceSkillTargetResolution {
  const context = resolveWorkspaceSkillContext(sources);
  if ("reason" in context) {
    return { status: "error", result: { status: "unavailable", reason: context.reason } };
  }

  let name: string;
  try {
    name = normalizeSkillName(requestedName);
  } catch (error) {
    return {
      status: "error",
      result: { status: "invalid", name: requestedName.trim(), issues: [errorMessage(error)] },
    };
  }

  const sourceConflict = resolveSkillSourceConflict(sources, context, name);
  return sourceConflict
    ? { status: "error", result: { status: "unavailable", reason: sourceConflict } }
    : { status: "resolved", context, name };
}

function readWorkspaceSkillHistory(
  sources: readonly AgentSelfSkillSource[],
  requestedName: string,
): readonly AgentSelfSkillHistoryEntry[] {
  const context = resolveWorkspaceSkillContext(sources);
  if ("reason" in context) throw new Error(context.reason);
  const name = normalizeSkillName(requestedName);
  const root = path.join(context.historyRoot, name);
  if (!fs.existsSync(root)) return [];
  const entries = fs.readdirSync(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => readHistoryMetadata(path.join(root, entry.name)))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function resolveWorkspaceSkillContext(
  sources: readonly AgentSelfSkillSource[],
): WorkspaceSkillContext | { readonly reason: string } {
  const workspaceSources = sources.filter((source) => source.kind === "workspace");
  if (workspaceSources.length === 0) return { reason: "当前主机未绑定可写的工作区 Skill 来源。" };
  if (workspaceSources.length > 1) return { reason: "工作区 Skill 来源存在冲突，写入已拒绝。" };
  const source = workspaceSources[0]!;
  return {
    source,
    root: source.root,
    historyRoot: path.join(source.root, SkillHistoryDirectoryName),
  };
}

function resolveSkillSourceConflict(
  sources: readonly AgentSelfSkillSource[],
  context: WorkspaceSkillContext,
  name: string,
): string | undefined {
  const otherSource = sources.find(
    (source) => source.id !== context.source.id && fs.existsSync(path.join(source.root, name)),
  );
  return otherSource
    ? `Skill ${name} 同时存在于 ${context.source.displayName} 和 ${otherSource.displayName}，请先处理来源冲突。`
    : undefined;
}

function normalizeSkillName(value: string): string {
  const name = value.trim().normalize("NFC");
  return assertAgentExtensionName(name);
}

function validateSkillContent(content: string): string | undefined {
  if (typeof content !== "string" || content.trim() === "") return "Skill 文档不能为空。";
  if (Buffer.byteLength(content, "utf8") > MaxSkillDocumentBytes) return "Skill 文档超过 1 MiB 限制。";
  return undefined;
}

function resolveSkillPath(root: string, name: string): string {
  const target = path.resolve(root, name);
  const relative = path.relative(path.resolve(root), target);
  if (
    path.isAbsolute(relative) ||
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    relative.includes(path.sep)
  ) {
    throw new Error("Skill 名称必须解析为工作区 Skill 根下的单级目录。");
  }
  return target;
}

function readWorkspaceSkill(
  context: WorkspaceSkillContext,
  scanner: AgentSkillScanner,
  name: string,
):
  | { readonly status: "found"; readonly value: WorkspaceSkillRead }
  | { readonly status: "missing" }
  | {
      readonly status: "invalid";
      readonly issues: readonly string[];
    } {
  const skillPath = resolveSkillPath(context.root, name);
  if (!fs.existsSync(skillPath)) return { status: "missing" };
  try {
    const summary = readSkillDirectorySummary(context.source, scanner, skillPath, name);
    const content = fs.readFileSync(path.join(skillPath, SkillDocumentFileName), "utf8");
    return { status: "found", value: { summary, content } };
  } catch (error) {
    return { status: "invalid", issues: [errorMessage(error)] };
  }
}

function readSkillDirectorySummary(
  source: AgentSelfSkillSource,
  scanner: AgentSkillScanner,
  skillPath: string,
  name: string,
): AgentSelfSkillSummary {
  const skill = scanner.readSkillDirectory(skillPath, name);
  return {
    name: skill.name,
    description: skill.description,
    descriptionFile: skill.descriptionFile,
    source: { id: source.id, displayName: source.displayName, kind: source.kind },
    revision: skill.revision,
    recommendedTools: [...skill.recommendedTools],
    valid: true,
    issues: [],
  };
}

function writeHistorySnapshot(
  context: WorkspaceSkillContext,
  skillPath: string,
  name: string,
  revision: string,
  action: "update" | "archive",
): string {
  const parent = path.join(context.historyRoot, name);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const finalPath = path.join(parent, revision);
  if (fs.existsSync(finalPath)) return finalPath;
  const stagingPath = path.join(parent, `.${revision}.${randomUUID()}.pending`);
  try {
    fs.cpSync(skillPath, stagingPath, { recursive: true, force: false });
    writeHistoryMetadata(stagingPath, {
      revision,
      action,
      createdAt: new Date().toISOString(),
      sourceRevision: revision,
    });
    fs.renameSync(stagingPath, finalPath);
    return finalPath;
  } finally {
    removeStagingPath(stagingPath);
  }
}

function writeHistoryMetadata(snapshotPath: string, metadata: AgentSelfSkillHistoryEntry): void {
  writeFileAtomicSync(path.join(snapshotPath, SkillHistoryMetadataFileName), `${JSON.stringify(metadata, null, 2)}\n`, {
    directoryMode: 0o700,
    fsync: true,
  });
}

function readHistoryMetadata(snapshotPath: string): AgentSelfSkillHistoryEntry {
  const raw = JSON.parse(
    fs.readFileSync(path.join(snapshotPath, SkillHistoryMetadataFileName), "utf8"),
  ) as Partial<AgentSelfSkillHistoryEntry>;
  if (
    typeof raw.revision !== "string" ||
    (raw.action !== "update" && raw.action !== "archive") ||
    typeof raw.createdAt !== "string" ||
    typeof raw.sourceRevision !== "string"
  ) {
    throw new Error(`Skill 历史记录无效: ${snapshotPath}`);
  }
  return raw as AgentSelfSkillHistoryEntry;
}

function removeHistorySnapshot(snapshotPath: string): void {
  try {
    fs.rmSync(snapshotPath, { recursive: true, force: true });
  } catch {
    // A failed cleanup is intentionally not allowed to replace the original
    // mutation error; the next history read reports the malformed entry.
  }
}

function projectMutationError(name: string, error: unknown): AgentSelfSkillMutationResult {
  const message = errorMessage(error);
  return error instanceof AgentSkillValidationError
    ? { status: "invalid", name, issues: [message] }
    : { status: "failed", name, error: message };
}

function removeStagingPath(stagingPath: string): void {
  try {
    fs.rmSync(stagingPath, { recursive: true, force: true });
  } catch {
    // Staging names are outside the active Skill namespace and can be cleaned
    // by the next doctor run if the host is interrupted while a file is locked.
  }
}
