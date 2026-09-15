import fs from "node:fs";
import path from "node:path";
import { isUtf8 } from "node:buffer";
import crypto from "node:crypto";
import { z } from "zod";
import { errorMessage } from "../Core/AgentErrors.js";
import { readRegularFileSync, readRegularTextFileSync } from "../Core/AgentFs.js";
import { agentDirectoryRevision } from "../Core/AgentDirectoryRevision.js";
import { AgentSourceDiagnosticBuilder } from "../Diagnostics/AgentSourceDiagnostic.js";
import { AgentExtensionNameSchema, assertAgentExtensionName } from "../Extensions/AgentExtensionIdentity.js";
import type { RegisteredSkill } from "./AgentSkillTypes.js";
import { parseAgentSkillDocument } from "./AgentSkillDocument.js";
import { agentSkillFrontmatterIssueDiagnostics } from "./AgentSkillFrontmatterDiagnostics.js";
import { AgentSkillMetadataSchema, agentSkillRecommendedTools } from "./AgentSkillToolBinding.js";
import { AgentSkillValidationError } from "./AgentSkillValidationError.js";

const SkillFileName = "SKILL.md";

export const AgentSkillResourceKinds = {
  Document: "document",
  Reference: "reference",
  Script: "script",
  Template: "template",
  Asset: "asset",
  Other: "other",
} as const;

export type AgentSkillResourceKind = (typeof AgentSkillResourceKinds)[keyof typeof AgentSkillResourceKinds];

export interface AgentSkillResourceDescriptor {
  readonly relativePath: string;
  readonly kind: AgentSkillResourceKind;
  readonly bytes: number;
  readonly digest: string;
}

export interface AgentSkillResourceRead extends AgentSkillResourceDescriptor {
  readonly encoding: "utf8" | "base64";
  readonly content: string;
}

const ResourceDirectoryKinds: Readonly<Record<string, AgentSkillResourceKind>> = {
  references: AgentSkillResourceKinds.Reference,
  scripts: AgentSkillResourceKinds.Script,
  templates: AgentSkillResourceKinds.Template,
  assets: AgentSkillResourceKinds.Asset,
};
const MaxSkillResourceBytes = 8 * 1024 * 1024;

const AgentSkillFrontmatterSchema = z
  .object({
    name: AgentExtensionNameSchema,
    description: z.string().trim().min(1),
    "disable-model-invocation": z.boolean().optional(),
    metadata: AgentSkillMetadataSchema.optional(),
  })
  .passthrough();

interface AgentSkillFrontmatter {
  readonly name: string;
  readonly description: string;
  readonly disableModelInvocation?: boolean;
  readonly recommendedTools: string[];
}

export class AgentSkillScanner {
  private readonly catalogsByRoot = new Map<
    string,
    { readonly revision: string; readonly skills: readonly RegisteredSkill[] }
  >();

  scanRoot(rootPath: string): RegisteredSkill[] {
    const root = path.resolve(rootPath);
    if (!fs.existsSync(root)) return [];
    assertRegularDirectory(root);
    const revision = agentDirectoryRevision(root);
    const cached = this.catalogsByRoot.get(root);
    if (cached?.revision === revision) return cached.skills.map(cloneRegisteredSkill);
    const skills: RegisteredSkill[] = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".") || !entry.isDirectory() || entry.isSymbolicLink()) continue;
      skills.push(this.readSkillDirectory(path.join(root, entry.name), entry.name));
    }
    this.catalogsByRoot.set(root, { revision, skills: skills.map(cloneRegisteredSkill) });
    return skills;
  }

  readSkillDirectory(skillRoot: string, expectedName?: string, revision?: string): RegisteredSkill {
    const root = path.resolve(skillRoot);
    assertRegularDirectory(root);
    const directoryName = expectedName ?? path.basename(root);
    assertAgentExtensionName(directoryName);
    const descriptionFile = path.join(root, SkillFileName);
    const source = readRegularTextFileSync(descriptionFile, "Skill source");
    const frontmatter = parseSkillFrontmatter(source, descriptionFile);
    if (frontmatter.name !== directoryName) {
      throw new Error(`Skill name ${frontmatter.name} must match its directory ${directoryName}.`);
    }
    return {
      source: {
        kind: "standalone",
        id: frontmatter.name,
        displayName: frontmatter.name,
      },
      name: frontmatter.name,
      description: frontmatter.description,
      descriptionFile,
      ...(frontmatter.disableModelInvocation === true ? { disableModelInvocation: true } : {}),
      revision: revision ?? agentDirectoryRevision(root),
      recommendedTools: frontmatter.recommendedTools,
      evidenceRequirements: [],
    };
  }

  listResources(skillRoot: string): AgentSkillResourceDescriptor[] {
    const root = path.resolve(skillRoot);
    assertRegularDirectory(root);
    return regularSkillResources(root).map(({ relativePath, content }) => ({
      relativePath,
      kind: classifySkillResource(relativePath),
      bytes: content.byteLength,
      digest: digestSkillResource(content),
    }));
  }

  readResource(skillRoot: string, relativePath: string): AgentSkillResourceRead {
    const root = path.resolve(skillRoot);
    assertRegularDirectory(root);
    const normalized = normalizeSkillResourcePath(relativePath);
    const target = path.resolve(root, ...normalized.split("/"));
    const relative = path.relative(root, target);
    if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
      throw new Error("Skill resource path must remain inside the selected Skill package.");
    }
    const content = readRegularFileSync(target, "Skill resource", { maxBytes: MaxSkillResourceBytes });
    return {
      relativePath: normalized,
      kind: classifySkillResource(normalized),
      bytes: content.byteLength,
      digest: digestSkillResource(content),
      encoding: isUtf8(content) ? "utf8" : "base64",
      content: isUtf8(content) ? content.toString("utf8") : content.toString("base64"),
    };
  }

  static sourceRevision(rootPath: string): string {
    return agentDirectoryRevision(rootPath);
  }
}

function cloneRegisteredSkill(skill: RegisteredSkill): RegisteredSkill {
  return {
    ...skill,
    source: { ...skill.source },
    recommendedTools: [...skill.recommendedTools],
    evidenceRequirements: skill.evidenceRequirements.map((requirement) => ({
      ...requirement,
      Accepts: [...requirement.Accepts],
      ...(requirement.MinimumQuality ? { MinimumQuality: [...requirement.MinimumQuality] } : {}),
    })),
    ...(skill.search
      ? {
          search: {
            ...skill.search,
            ...(skill.search.Tags ? { Tags: [...skill.search.Tags] } : {}),
            ...(skill.search.UseCases ? { UseCases: [...skill.search.UseCases] } : {}),
            ...(skill.search.Examples ? { Examples: [...skill.search.Examples] } : {}),
            ...(skill.search.Avoid ? { Avoid: [...skill.search.Avoid] } : {}),
          },
        }
      : {}),
  };
}

function parseSkillFrontmatter(source: string, filePath: string): AgentSkillFrontmatter {
  let document: ReturnType<typeof parseAgentSkillDocument>;
  try {
    document = parseAgentSkillDocument(source);
  } catch (error) {
    const linePosition = yamlErrorLinePosition(error);
    const sourceDiagnostic = linePosition
      ? new AgentSourceDiagnosticBuilder(source).fromLineColumn(
          errorMessage(error),
          linePosition.line,
          linePosition.column,
        )
      : undefined;
    throw new AgentSkillValidationError(`Skill frontmatter YAML is invalid at ${filePath}.`, [
      {
        severity: "error",
        code: "skill.frontmatter.yaml",
        message: errorMessage(error),
        filePath,
        ...sourceDiagnostic,
      },
    ]);
  }
  const parsed = AgentSkillFrontmatterSchema.safeParse(document.data);
  if (parsed.success) {
    return {
      name: parsed.data.name,
      description: parsed.data.description,
      ...(parsed.data["disable-model-invocation"] === true ? { disableModelInvocation: true } : {}),
      recommendedTools: agentSkillRecommendedTools(parsed.data.metadata),
    };
  }
  throw new AgentSkillValidationError(
    `Skill frontmatter is invalid at ${filePath}.`,
    agentSkillFrontmatterIssueDiagnostics(source, filePath, parsed.error.issues, "skill.frontmatter.schema"),
  );
}

function yamlErrorLinePosition(error: unknown): { line: number; column: number } | undefined {
  if (!error || typeof error !== "object" || !("linePos" in error) || !Array.isArray(error.linePos)) return undefined;
  const position = error.linePos[0];
  if (!position || typeof position.line !== "number" || typeof position.col !== "number") return undefined;
  return { line: position.line, column: position.col };
}

function assertRegularDirectory(directory: string): void {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Expected a regular Skill directory: ${directory}`);
}

function regularSkillResources(root: string): Array<{ readonly relativePath: string; readonly content: Buffer }> {
  const resources: Array<{ readonly relativePath: string; readonly content: Buffer }> = [];
  const visit = (directory: string): void => {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".")) continue;
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Skill packages cannot contain symbolic links: ${target}`);
      if (entry.isDirectory()) {
        visit(target);
        continue;
      }
      if (!entry.isFile()) throw new Error(`Skill packages can only contain regular files: ${target}`);
      const content = fs.readFileSync(target);
      if (content.byteLength > MaxSkillResourceBytes) {
        throw new Error(`Skill resource exceeds the ${MaxSkillResourceBytes} byte limit: ${target}`);
      }
      resources.push({ relativePath: path.relative(root, target).split(path.sep).join("/"), content });
    }
  };
  visit(root);
  return resources;
}

function normalizeSkillResourcePath(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/");
  if (!normalized || normalized === "." || normalized.startsWith("/") || normalized.includes("\0")) {
    throw new Error("Skill resource path must be a non-empty relative path.");
  }
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Skill resource path cannot contain dot segments.");
  }
  if (segments.some((segment) => segment.startsWith("."))) {
    throw new Error("Skill resource path cannot address hidden files.");
  }
  return segments.join("/");
}

function classifySkillResource(relativePath: string): AgentSkillResourceKind {
  const [first, ...rest] = relativePath.split("/");
  if (relativePath === SkillFileName) return AgentSkillResourceKinds.Document;
  if (rest.length === 0) return AgentSkillResourceKinds.Other;
  return ResourceDirectoryKinds[first ?? ""] ?? AgentSkillResourceKinds.Other;
}

function digestSkillResource(content: NodeJS.ArrayBufferView): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}
