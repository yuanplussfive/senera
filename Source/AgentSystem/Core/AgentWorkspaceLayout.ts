import fs from "node:fs";
import path from "node:path";
import { relativePathWithin } from "./AgentPath.js";

const WorkspaceLayout = {
  stateDirectory: ".senera",
  skillsDirectory: "skills",
  mcpDirectory: "mcp",
  contextDirectory: "context",
  projectContextFile: "PROJECT.md",
  exportsDirectory: "exports",
  sessionExportsDirectory: "sessions",
  dataDirectory: "data",
  databases: {
    config: ["config", "config.sqlite"],
    credentials: ["credentials", "credentials.sqlite"],
    sessions: ["sessions", "sessions.sqlite"],
    memory: ["memory", "memory.sqlite"],
    toolSearch: ["tool-search", "tool-search.sqlite"],
  },
  configSecretKey: ["config", "config-secrets.key"],
  credentialSecretKey: ["credentials", "credentials.key"],
} as const;

const LegacyWorkspaceLayout = {
  skillsDirectory: ".skills",
  databases: [
    { domain: "config", fileName: "Config.sqlite" },
    { domain: "sessions", fileName: "senera.db" },
    { domain: "memory", fileName: "Memory.sqlite" },
    { domain: "toolSearch", fileName: "ToolSearchLearning.sqlite" },
    { domain: "toolSearch", fileName: "ToolSearch.sqlite" },
  ],
  configSecretKey: "config-secrets.key",
} as const;

const RepositoryMetadataDirectories = [".git", ".agents", ".codex"] as const;

export const AgentWorkspaceResourceDomains = {
  WorkspaceContent: "workspace-content",
  ManagedSkill: "managed-skill",
  ManagedMcp: "managed-mcp",
  HostState: "host-state",
  RepositoryMetadata: "repository-metadata",
  Temporary: "temporary",
  Unknown: "unknown",
} as const;

export type AgentWorkspaceResourceDomain =
  (typeof AgentWorkspaceResourceDomains)[keyof typeof AgentWorkspaceResourceDomains];

export interface AgentWorkspaceResourceClassification {
  readonly domain: AgentWorkspaceResourceDomain;
  readonly domainRoot: boolean;
}

export interface AgentWorkspaceLayout {
  readonly root: string;
  readonly stateRoot: string;
  readonly skillRoot: string;
  readonly mcpRoot: string;
  readonly contextRoot: string;
  readonly projectContextFile: string;
  readonly exportsRoot: string;
  readonly sessionExportsRoot: string;
  readonly dataRoot: string;
  readonly databases: {
    readonly config: string;
    readonly credentials: string;
    readonly sessions: string;
    readonly memory: string;
    readonly toolSearch: string;
  };
  readonly configSecretKey: string;
  readonly credentialSecretKey: string;
}

export function resolveAgentWorkspaceLayout(workspaceRoot: string): AgentWorkspaceLayout {
  const root = path.resolve(workspaceRoot);
  const stateRoot = path.join(root, WorkspaceLayout.stateDirectory);
  const dataRoot = path.join(stateRoot, WorkspaceLayout.dataDirectory);
  return {
    root,
    stateRoot,
    skillRoot: path.join(stateRoot, WorkspaceLayout.skillsDirectory),
    mcpRoot: path.join(stateRoot, WorkspaceLayout.mcpDirectory),
    contextRoot: path.join(stateRoot, WorkspaceLayout.contextDirectory),
    projectContextFile: path.join(stateRoot, WorkspaceLayout.contextDirectory, WorkspaceLayout.projectContextFile),
    exportsRoot: path.join(stateRoot, WorkspaceLayout.exportsDirectory),
    sessionExportsRoot: path.join(stateRoot, WorkspaceLayout.exportsDirectory, WorkspaceLayout.sessionExportsDirectory),
    dataRoot,
    databases: Object.fromEntries(
      Object.entries(WorkspaceLayout.databases).map(([domain, segments]) => [domain, path.join(dataRoot, ...segments)]),
    ) as AgentWorkspaceLayout["databases"],
    configSecretKey: path.join(dataRoot, ...WorkspaceLayout.configSecretKey),
    credentialSecretKey: path.join(dataRoot, ...WorkspaceLayout.credentialSecretKey),
  };
}

export function classifyAgentWorkspaceResource(
  workspaceRoot: string,
  targetPath: string,
  scope: "workspace" | "temporary" = "workspace",
): AgentWorkspaceResourceClassification {
  if (scope === "temporary") {
    return { domain: AgentWorkspaceResourceDomains.Temporary, domainRoot: false };
  }

  const layout = resolveAgentWorkspaceLayout(workspaceRoot);
  const target = path.resolve(targetPath);
  if (relativePathWithin(layout.root, target) === undefined) {
    return { domain: AgentWorkspaceResourceDomains.Unknown, domainRoot: false };
  }

  const managedSkill = classifyWithinRoot(layout.skillRoot, target, AgentWorkspaceResourceDomains.ManagedSkill);
  if (managedSkill) return managedSkill;
  const managedMcp = classifyWithinRoot(layout.mcpRoot, target, AgentWorkspaceResourceDomains.ManagedMcp);
  if (managedMcp) return managedMcp;
  const hostState = classifyWithinRoot(layout.stateRoot, target, AgentWorkspaceResourceDomains.HostState);
  if (hostState) return hostState;

  for (const directory of RepositoryMetadataDirectories) {
    const metadata = classifyWithinRoot(
      path.join(layout.root, directory),
      target,
      AgentWorkspaceResourceDomains.RepositoryMetadata,
    );
    if (metadata) return metadata;
  }

  return {
    domain: AgentWorkspaceResourceDomains.WorkspaceContent,
    domainRoot: target === layout.root,
  };
}

export function findAgentWorkspaceRoot(statePath: string): string | undefined {
  let current = path.resolve(statePath);
  while (true) {
    if (path.basename(current) === WorkspaceLayout.stateDirectory) return path.dirname(current);
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function migrateLegacyAgentDatabaseFileFamily(sourcePath: string, targetPath: string): void {
  const destinationPath = fs.existsSync(targetPath)
    ? path.join(path.dirname(targetPath), "legacy", path.basename(sourcePath))
    : targetPath;
  migrateFileFamily(path.dirname(sourcePath), path.basename(sourcePath), destinationPath);
}

export function migrateLegacyAgentWorkspaceLayout(workspaceRoot: string): void {
  const layout = resolveAgentWorkspaceLayout(workspaceRoot);
  migrateDirectory(path.join(layout.root, LegacyWorkspaceLayout.skillsDirectory), layout.skillRoot);

  for (const { domain, fileName } of LegacyWorkspaceLayout.databases) {
    migrateLegacyAgentDatabaseFileFamily(path.join(layout.stateRoot, fileName), layout.databases[domain]);
  }
  migrateFile(path.join(layout.stateRoot, LegacyWorkspaceLayout.configSecretKey), layout.configSecretKey);
}

function migrateDirectory(source: string, target: string): void {
  if (!fs.existsSync(source)) return;
  assertMigrationTargetAvailable(source, target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(source, target);
}

function migrateFileFamily(sourceDirectory: string, sourceName: string, targetPath: string): void {
  if (!fs.existsSync(sourceDirectory)) return;
  const members = fs
    .readdirSync(sourceDirectory)
    .filter((name) => name === sourceName || name.startsWith(`${sourceName}-`) || name.startsWith(`${sourceName}.`));
  if (members.length === 0) return;

  const migrations = members.map((name) => ({
    source: path.join(sourceDirectory, name),
    target: `${targetPath}${name.slice(sourceName.length)}`,
  }));
  for (const migration of migrations) assertMigrationTargetAvailable(migration.source, migration.target);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  for (const migration of migrations) fs.renameSync(migration.source, migration.target);
}

function migrateFile(source: string, target: string): void {
  if (!fs.existsSync(source)) return;
  assertMigrationTargetAvailable(source, target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(source, target);
}

function assertMigrationTargetAvailable(source: string, target: string): void {
  if (fs.existsSync(target)) {
    throw new Error(`Workspace layout migration cannot replace ${target}; legacy source remains at ${source}.`);
  }
}

function classifyWithinRoot(
  root: string,
  target: string,
  domain: AgentWorkspaceResourceDomain,
): AgentWorkspaceResourceClassification | undefined {
  const relative = relativePathWithin(root, target);
  return relative === undefined ? undefined : { domain, domainRoot: relative === "" };
}
