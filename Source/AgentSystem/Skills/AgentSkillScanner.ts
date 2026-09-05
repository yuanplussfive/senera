import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { errorMessage } from "../Core/AgentErrors.js";
import { readRegularTextFileSync } from "../Core/AgentFs.js";
import { agentDirectoryRevision } from "../Core/AgentDirectoryRevision.js";
import { AgentSourceDiagnosticBuilder } from "../Diagnostics/AgentSourceDiagnostic.js";
import { AgentExtensionNameSchema, assertAgentExtensionName } from "../Extensions/AgentExtensionIdentity.js";
import type { RegisteredSkill } from "./AgentSkillTypes.js";
import { parseAgentSkillDocument } from "./AgentSkillDocument.js";
import { agentSkillFrontmatterIssueDiagnostics } from "./AgentSkillFrontmatterDiagnostics.js";
import { AgentSkillMetadataSchema, agentSkillRecommendedTools } from "./AgentSkillToolBinding.js";
import { AgentSkillValidationError } from "./AgentSkillValidationError.js";

const SkillFileName = "SKILL.md";

const AgentSkillFrontmatterSchema = z
  .object({
    name: AgentExtensionNameSchema,
    description: z.string().trim().min(1),
    metadata: AgentSkillMetadataSchema.optional(),
  })
  .passthrough();

interface AgentSkillFrontmatter {
  readonly name: string;
  readonly description: string;
  readonly recommendedTools: string[];
}

export class AgentSkillScanner {
  scanRoot(rootPath: string): RegisteredSkill[] {
    const root = path.resolve(rootPath);
    if (!fs.existsSync(root)) return [];
    assertRegularDirectory(root);
    const skills: RegisteredSkill[] = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".") || !entry.isDirectory() || entry.isSymbolicLink()) continue;
      skills.push(this.readSkillDirectory(path.join(root, entry.name), entry.name));
    }
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
      revision: revision ?? agentDirectoryRevision(root),
      recommendedTools: frontmatter.recommendedTools,
      evidenceRequirements: [],
    };
  }

  static sourceRevision(rootPath: string): string {
    return agentDirectoryRevision(rootPath);
  }
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
