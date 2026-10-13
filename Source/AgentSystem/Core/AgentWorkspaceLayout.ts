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
    orchestration: ["orchestration", "orchestration.sqlite"],
    channels: ["channels", "channels.sqlite"],
    memos: ["memos", "memos.sqlite"],
    artifactManifestIndex: ["artifacts", "manifest-index.sqlite"],
    workspaceObserver: ["workspace-observer", "workspace-observer.sqlite"],
  },
  caches: {
    toolSearchEmbeddings: ["tool-search", "embeddings.json"],
    toolObservationSift: ["tool-observation", "sift"],
    mcpSchemas: ["mcp", "schemas"],
    workspaceObserverContents: ["workspace-observer", "contents"],
  },
  configSecretKey: ["config", "config-secrets.key"],
  credentialSecretKey: ["credentials", "credentials.key"],
  continuityIdentity: "continuity-identity.json",
} as const;

const LegacyWorkspaceLayout = {
  skillsDirectory: ".skills",
  databases: [
    { domain: "config", fileName: "Config.sqlite" },
    { domain: "sessions", fileName: "senera.db" },
    { domain: "memory", fileName: "Memory.sqlite" },
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
  /** Desktop runtime state when this layout represents the application directory. */
  readonly desktopRuntimeRoot: string;
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
    readonly orchestration: string;
    readonly channels: string;
    /** MemOS graph database; semantic memory is isolated from the physical memory catalog. */
    readonly memos: string;
    /** Derived Artifact manifest lookup index; raw manifests remain canonical files. */
    readonly artifactManifestIndex: string;
    /** Derived filesystem baseline used by the workspace change observer. */
    readonly workspaceObserver: string;
  };
  readonly caches: {
    /** Derived capability vectors; safe to rebuild when missing or stale. */
    readonly toolSearchEmbeddings: string;
    /** Derived source stash used by content-aware tool observation projection. */
    readonly toolObservationSift: string;
    /** Derived MCP tools/list declarations; safe to rebuild when stale. */
    readonly mcpSchemas: string;
    /** Content-addressed text retained for changed-file before/after materialization. */
    readonly workspaceObserverContents: string;
  };
  readonly configSecretKey: string;
  readonly credentialSecretKey: string;
  /** Stable logical identities used by continuity; never a filesystem path. */
  readonly continuityIdentity: string;
}

export function resolveAgentWorkspaceLayout(workspaceRoot: string, runtimeStateRoot?: string): AgentWorkspaceLayout {
  const root = path.resolve(workspaceRoot);
  const projectStateRoot = path.join(root, WorkspaceLayout.stateDirectory);
  const stateRoot = runtimeStateRoot ? path.resolve(runtimeStateRoot) : projectStateRoot;
  const dataRoot = path.join(stateRoot, WorkspaceLayout.dataDirectory);
  return {
    root,
    stateRoot,
    desktopRuntimeRoot: path.join(stateRoot, "desktop"),
    skillRoot: path.join(projectStateRoot, WorkspaceLayout.skillsDirectory),
    mcpRoot: path.join(projectStateRoot, WorkspaceLayout.mcpDirectory),
    contextRoot: path.join(projectStateRoot, WorkspaceLayout.contextDirectory),
    projectContextFile: path.join(
      projectStateRoot,
      WorkspaceLayout.contextDirectory,
      WorkspaceLayout.projectContextFile,
    ),
    exportsRoot: path.join(projectStateRoot, WorkspaceLayout.exportsDirectory),
    sessionExportsRoot: path.join(
      projectStateRoot,
      WorkspaceLayout.exportsDirectory,
      WorkspaceLayout.sessionExportsDirectory,
    ),
    dataRoot,
    databases: Object.fromEntries(
      Object.entries(WorkspaceLayout.databases).map(([domain, segments]) => [domain, path.join(dataRoot, ...segments)]),
    ) as AgentWorkspaceLayout["databases"],
    caches: Object.fromEntries(
      Object.entries(WorkspaceLayout.caches).map(([name, segments]) => [name, path.join(dataRoot, ...segments)]),
    ) as AgentWorkspaceLayout["caches"],
    configSecretKey: path.join(dataRoot, ...WorkspaceLayout.configSecretKey),
    credentialSecretKey: path.join(dataRoot, ...WorkspaceLayout.credentialSecretKey),
    continuityIdentity: path.join(dataRoot, WorkspaceLayout.continuityIdentity),
  };
}

export function listAgentWorkspaceNonContentRoots(workspaceRoot: string): string[] {
  const layout = resolveAgentWorkspaceLayout(workspaceRoot);
  return [layout.stateRoot, ...RepositoryMetadataDirectories.map((directory) => path.join(layout.root, directory))];
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
