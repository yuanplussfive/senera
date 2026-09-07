import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { deepFreeze } from "../Core/AgentDeepFreeze.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { isPathWithin } from "../Core/AgentPath.js";

const ThinkingLevelSchema = z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const RoleFrontmatterSchema = z
  .object({
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
    default: z.boolean().default(false),
    workspaceAccess: z.enum(["read_only", "read_write"]),
    canDelegate: z.boolean().default(false),
    aliases: z.array(z.string().trim().min(1)).default([]),
    skills: z.array(z.string().trim().min(1)).default([]),
    model: z.string().trim().min(1).optional(),
    fallbackModels: z.array(z.string().trim().min(1)).default([]),
    thinking: ThinkingLevelSchema.optional(),
    systemPromptMode: z.enum(["append", "replace"]).default("replace"),
    inheritProjectContext: z.boolean().default(true),
    inheritSkills: z.boolean().default(false),
    defaultContext: z.enum(["fresh", "fork"]).default("fresh"),
  })
  .strict();

export type AgentSubagentRoleSource = "builtin" | "workspace";

export interface AgentSubagentRoleDefinition {
  readonly id: string;
  readonly description: string;
  readonly isDefault: boolean;
  readonly workspaceAccess: "read_only" | "read_write";
  readonly canDelegate: boolean;
  readonly aliases: readonly string[];
  readonly source: AgentSubagentRoleSource;
  readonly filePath: string;
  readonly revision: string;
  readonly systemPrompt: string;
  readonly systemPromptMode: "append" | "replace";
  readonly inheritProjectContext: boolean;
  readonly inheritSkills: boolean;
  readonly skills: readonly string[];
  readonly model?: string;
  readonly fallbackModels: readonly string[];
  readonly thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  readonly defaultContext: "fresh" | "fork";
}

export interface AgentSubagentRoleCatalogEntry {
  readonly id: string;
  readonly description: string;
  readonly isDefault: boolean;
  readonly workspaceAccess: "read_only" | "read_write";
  readonly canDelegate: boolean;
  readonly aliases: readonly string[];
  readonly source: AgentSubagentRoleSource;
}

export interface AgentSubagentRoleCatalogSnapshot {
  readonly revision: string;
  readonly defaultRoleId: string;
  readonly roles: readonly AgentSubagentRoleCatalogEntry[];
}

export interface AgentSubagentRoleCatalogPort {
  snapshot(workspaceRoot: string): AgentSubagentRoleCatalogSnapshot;
  resolve(workspaceRoot: string, requestedRole: string): AgentSubagentRoleDefinition;
  resolveDefault(workspaceRoot: string): AgentSubagentRoleDefinition;
}

export interface AgentSubagentRoleCatalogOptions {
  readonly builtinRoot?: string;
  readonly discover?: (workspaceRoot: string) => readonly AgentSubagentRoleDefinition[];
}

export class AgentSubagentRoleCatalog implements AgentSubagentRoleCatalogPort {
  private cached?: {
    readonly workspaceRoot: string;
    readonly definitions: readonly AgentSubagentRoleDefinition[];
    readonly snapshot: AgentSubagentRoleCatalogSnapshot;
  };

  constructor(private readonly options: AgentSubagentRoleCatalogOptions = {}) {}

  snapshot(workspaceRoot: string): AgentSubagentRoleCatalogSnapshot {
    return this.read(workspaceRoot).snapshot;
  }

  resolve(workspaceRoot: string, requestedRole: string): AgentSubagentRoleDefinition {
    const normalized = requestedRole.trim();
    const definitions = this.read(workspaceRoot).definitions;
    const exact = definitions.find((role) => role.id === normalized);
    if (exact) return exact;
    const aliases = definitions.filter((role) => role.aliases.includes(normalized));
    if (aliases.length === 1) return aliases[0]!;
    if (aliases.length > 1) {
      throw new Error(
        `Subagent role alias '${normalized}' is ambiguous across: ${aliases.map((role) => role.id).join(", ")}.`,
      );
    }
    throw new Error(`Unknown subagent role: ${normalized}`);
  }

  resolveDefault(workspaceRoot: string): AgentSubagentRoleDefinition {
    const catalog = this.read(workspaceRoot);
    const role = catalog.definitions.find((candidate) => candidate.id === catalog.snapshot.defaultRoleId);
    if (!role) throw new Error(`Default subagent role is unavailable: ${catalog.snapshot.defaultRoleId}`);
    return role;
  }

  private read(workspaceRoot: string) {
    const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
    const discovered = this.options.discover
      ? this.options.discover(resolvedWorkspaceRoot)
      : discoverRoleDefinitions(resolvedWorkspaceRoot, this.options.builtinRoot);
    const definitions = selectRoleOverrides(discovered);
    const defaultRole = definitions.find((role) => role.isDefault)!;
    const revision = sha256HexOfCanonicalJson(definitions.map(projectRevisionInput));
    if (this.cached?.workspaceRoot === resolvedWorkspaceRoot && this.cached.snapshot.revision === revision) {
      return this.cached;
    }
    const snapshot = deepFreeze({
      revision,
      defaultRoleId: defaultRole.id,
      roles: definitions.map((role) => ({
        id: role.id,
        description: role.description,
        isDefault: role.isDefault,
        workspaceAccess: role.workspaceAccess,
        canDelegate: role.canDelegate,
        aliases: [...role.aliases],
        source: role.source,
      })),
    });
    this.cached = { workspaceRoot: resolvedWorkspaceRoot, definitions: deepFreeze(definitions), snapshot };
    return this.cached;
  }
}

function discoverRoleDefinitions(workspaceRoot: string, configuredBuiltinRoot?: string): AgentSubagentRoleDefinition[] {
  const builtinRoot = path.resolve(
    configuredBuiltinRoot ?? path.join(workspaceRoot, "System", "Extensions", "agent-delegation", "agents"),
  );
  if (!fs.existsSync(builtinRoot)) throw new Error(`Bundled subagent role directory does not exist: ${builtinRoot}`);
  return [
    ...readRoleDirectory(builtinRoot, "builtin"),
    ...readRoleDirectory(path.join(workspaceRoot, ".senera", "agents"), "workspace"),
  ];
}

function readRoleDirectory(root: string, source: AgentSubagentRoleSource): AgentSubagentRoleDefinition[] {
  if (!fs.existsSync(root)) return [];
  const resolvedRoot = path.resolve(root);
  const stat = fs.lstatSync(resolvedRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(`Subagent role root must be a regular directory: ${root}`);
  return walkMarkdownFiles(resolvedRoot).map((filePath) => readRole(filePath, resolvedRoot, source));
}

function walkMarkdownFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".")) continue;
      const candidate = path.join(directory, entry.name);
      if (!isPathWithin(root, candidate)) throw new Error(`Subagent role path escaped its root: ${candidate}`);
      if (entry.isSymbolicLink())
        throw new Error(`Subagent role directories cannot contain symbolic links: ${candidate}`);
      if (entry.isDirectory()) visit(candidate);
      else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md") files.push(candidate);
    }
  };
  visit(root);
  return files;
}

function readRole(filePath: string, root: string, source: AgentSubagentRoleSource): AgentSubagentRoleDefinition {
  const document = matter(fs.readFileSync(filePath, "utf8"), {
    engines: { yaml: { parse: (value: string) => parseYaml(value) } },
  });
  const frontmatter = RoleFrontmatterSchema.parse(document.data);
  const systemPrompt = normalizeNewlines(document.content).trim();
  if (!systemPrompt) throw new Error(`Subagent role has an empty instruction body: ${filePath}`);
  if (!isPathWithin(root, filePath)) throw new Error(`Subagent role file escaped its source root: ${filePath}`);
  const aliases = uniqueSorted(frontmatter.aliases.filter((alias) => alias !== frontmatter.name));
  const revision = sha256HexOfCanonicalJson({ frontmatter, systemPrompt });
  return {
    id: frontmatter.name,
    description: frontmatter.description,
    isDefault: frontmatter.default,
    workspaceAccess: frontmatter.workspaceAccess,
    canDelegate: frontmatter.canDelegate,
    aliases,
    source,
    filePath,
    revision,
    systemPrompt,
    systemPromptMode: frontmatter.systemPromptMode,
    inheritProjectContext: frontmatter.inheritProjectContext,
    inheritSkills: frontmatter.inheritSkills,
    skills: unique(frontmatter.skills),
    ...(frontmatter.model ? { model: frontmatter.model } : {}),
    fallbackModels: unique(frontmatter.fallbackModels),
    ...(frontmatter.thinking ? { thinking: frontmatter.thinking } : {}),
    defaultContext: frontmatter.defaultContext,
  };
}

function selectRoleOverrides(discovered: readonly AgentSubagentRoleDefinition[]): AgentSubagentRoleDefinition[] {
  const selected = new Map<string, AgentSubagentRoleDefinition>();
  for (const source of ["builtin", "workspace"] as const) {
    for (const role of discovered.filter((candidate) => candidate.source === source)) selected.set(role.id, role);
  }
  const definitions = [...selected.values()].sort((left, right) => left.id.localeCompare(right.id));
  const defaults = definitions.filter((role) => role.isDefault);
  if (defaults.length !== 1) {
    throw new Error(
      `Subagent role catalog must declare exactly one default role; found ${defaults.length}: ${defaults
        .map((role) => role.id)
        .join(", ")}.`,
    );
  }
  const roleIds = new Set(definitions.map((role) => role.id));
  const aliasOwners = new Map<string, string[]>();
  for (const role of definitions) {
    for (const alias of role.aliases) {
      if (roleIds.has(alias)) {
        throw new Error(`Subagent role alias '${alias}' shadows the canonical role with the same id.`);
      }
      aliasOwners.set(alias, [...(aliasOwners.get(alias) ?? []), role.id]);
    }
  }
  const duplicate = [...aliasOwners].find(([, owners]) => owners.length > 1);
  if (duplicate) throw new Error(`Subagent role alias '${duplicate[0]}' is declared by: ${duplicate[1].join(", ")}.`);
  return definitions;
}

function projectRevisionInput(role: AgentSubagentRoleDefinition) {
  return {
    id: role.id,
    description: role.description,
    isDefault: role.isDefault,
    workspaceAccess: role.workspaceAccess,
    canDelegate: role.canDelegate,
    aliases: role.aliases,
    source: role.source,
    filePath: path.resolve(role.filePath),
    revision: role.revision,
  };
}

function normalizeNewlines(value: string): string {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function uniqueSorted(values: readonly string[]): string[] {
  return unique(values).sort((left, right) => left.localeCompare(right));
}
