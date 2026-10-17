import fs from "node:fs";
import path from "node:path";
import { relativePathWithin } from "../Core/AgentPath.js";
import { readRegularFileSync } from "../Core/AgentFs.js";
import {
  AgentPromptPresetFileExtension,
  parseAgentPromptPresetManifest,
  type AgentPromptPresetManifest,
} from "../Core/AgentPromptPresetContract.js";
import { resolveAgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";
import {
  createAgentPersonaContext,
  EmptyAgentPersonaContext,
  type AgentPersonaContext,
} from "./AgentPersonaContext.js";
export {
  AgentPromptPresetDirectoryName,
  AgentPromptPresetDirectoryPath,
  AgentPromptPresetFileExtension,
  AgentPromptPresetManifestVersion,
} from "../Core/AgentPromptPresetContract.js";
export type { AgentPromptPresetManifest } from "../Core/AgentPromptPresetContract.js";

export interface AgentMarkdownPromptPresetReadResult {
  readonly context: AgentPersonaContext;
  readonly path?: string;
  readonly error?: string;
}

/** Reads the active prompt document without changing the workspace or config store. */
export function readAgentMarkdownPromptPreset(
  workspaceRoot: string,
  maxBytes: number,
): AgentMarkdownPromptPresetReadResult {
  const layout = resolveAgentWorkspaceLayout(workspaceRoot);
  let manifest: AgentPromptPresetManifest;
  try {
    const parsed: unknown = JSON.parse(
      readRegularFileSync(layout.promptPresetStateFile, "Prompt preset state", { maxBytes }).toString("utf8"),
    );
    const normalized = parseAgentPromptPresetManifest(parsed);
    if (!normalized) return { context: EmptyAgentPersonaContext, error: "Prompt preset state is invalid." };
    manifest = normalized;
  } catch (error) {
    if (isMissingFileError(error)) return { context: EmptyAgentPersonaContext };
    return { context: EmptyAgentPersonaContext, error: errorMessage(error) };
  }

  const activePath = normalizeWorkspacePath(manifest.activePath);
  if (!activePath || path.extname(activePath).toLocaleLowerCase() !== AgentPromptPresetFileExtension) {
    return { context: EmptyAgentPersonaContext, error: "The active prompt preset must be a Markdown file." };
  }
  const absolutePath = path.resolve(workspaceRoot, activePath);
  const promptPresetRoot = path.resolve(layout.promptPresetRoot);
  if (relativePathWithin(promptPresetRoot, absolutePath) === undefined) {
    return {
      context: EmptyAgentPersonaContext,
      error: "The active prompt preset is outside the prompt preset directory.",
    };
  }

  if (!manifest.enabled) return { context: EmptyAgentPersonaContext, path: activePath };

  try {
    const canonicalPath = fs.realpathSync.native(absolutePath);
    if (relativePathWithin(promptPresetRoot, canonicalPath) === undefined) {
      return {
        context: EmptyAgentPersonaContext,
        path: activePath,
        error: "The active prompt preset is outside the prompt preset directory.",
      };
    }
    const stat = fs.lstatSync(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return {
        context: EmptyAgentPersonaContext,
        path: activePath,
        error: "The active prompt preset is not a regular file.",
      };
    }
    const markdown = readRegularFileSync(absolutePath, "Prompt preset", { maxBytes }).toString("utf8");
    return { context: createAgentPersonaContext(markdown, activePath), path: activePath };
  } catch (error) {
    return { context: EmptyAgentPersonaContext, path: activePath, error: errorMessage(error) };
  }
}

function normalizeWorkspacePath(value: string): string | undefined {
  const portable = value.trim().replace(/\\/gu, "/");
  if (!portable || portable.startsWith("/") || /^[a-z]:/iu.test(portable)) return undefined;
  const normalized = path.posix.normalize(portable);
  if (normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) return undefined;
  return normalized;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT",
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
