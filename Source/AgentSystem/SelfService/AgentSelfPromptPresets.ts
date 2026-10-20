import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { isMissingFileError, writeFileAtomic } from "../Core/AgentFs.js";
import { relativePathWithin } from "../Core/AgentPath.js";
import {
  AgentPromptPresetDirectoryPath,
  AgentPromptPresetFileExtension,
  AgentPromptPresetManifestVersion,
  normalizeAgentPromptPresetPath,
  parseAgentPromptPresetManifest,
  type AgentPromptPresetManifest,
} from "../Core/AgentPromptPresetContract.js";
import { resolveAgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";
import { stringifyAgentCanonicalJson } from "../Core/AgentCanonicalJson.js";
import type {
  AgentSelfPromptPresetEntry,
  AgentSelfPromptPresetMutationResult,
  AgentSelfPromptPresetReadResult,
  AgentSelfPromptPresetStatus,
  AgentSelfServicePort,
} from "./AgentSelfServiceTypes.js";

/**
 * Workspace-owned Markdown preset access for the self-service command surface.
 * The pointer is host state, while the document remains ordinary workspace
 * content. No caller receives the state file path as an editable resource.
 */
export function createAgentSelfPromptPresetsPort(
  workspaceRoot: string,
  maxBytes: number,
): NonNullable<AgentSelfServicePort["promptPresets"]> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("Prompt preset size limit must be a positive safe integer.");
  }

  const layout = resolveAgentWorkspaceLayout(workspaceRoot);
  return {
    status: () => projectStatus(layout, maxBytes),
    read: (requestedPath) => readPreset(layout, requestedPath, maxBytes),
    enable: (requestedPath) => setEnabled(layout, requestedPath, maxBytes),
    disable: () => setDisabled(layout, maxBytes),
  };
}

async function projectStatus(
  layout: ReturnType<typeof resolveAgentWorkspaceLayout>,
  maxBytes: number,
): Promise<AgentSelfPromptPresetStatus> {
  const state = await readManifest(layout, maxBytes);
  const activePath = state.manifest?.activePath;
  const enabled = state.manifest?.enabled === true;
  const scan = await listPresetFiles(layout, activePath, enabled);
  const errors = [...(state.error ? [state.error] : []), ...scan.errors];
  if (enabled && activePath && !scan.files.some((preset) => preset.active)) {
    errors.push("当前启用的 Markdown 预设不存在或不是普通文件。");
  }
  return {
    root: path.relative(layout.root, layout.promptPresetRoot).split(path.sep).join("/"),
    valid: errors.length === 0,
    enabled,
    ...(activePath ? { activePath } : {}),
    presets: scan.files,
    ...(errors.length > 0 ? { errors, error: errors.join("; ") } : {}),
  };
}

async function listPresetFiles(
  layout: ReturnType<typeof resolveAgentWorkspaceLayout>,
  activePath: string | undefined,
  enabled: boolean,
): Promise<{ readonly files: readonly AgentSelfPromptPresetEntry[]; readonly errors: readonly string[] }> {
  const root = layout.promptPresetRoot;
  const rootState = await inspectPresetRoot(root);
  if (rootState.error) return { files: [], errors: [rootState.error] };
  if (!rootState.exists) return { files: [], errors: [] };
  const files: AgentSelfPromptPresetEntry[] = [];
  const errors: string[] = [];
  await walkPresetDirectory(root, root, activePath, enabled, files, errors);
  return { files: files.sort((left, right) => left.path.localeCompare(right.path)), errors };
}

async function walkPresetDirectory(
  root: string,
  current: string,
  activePath: string | undefined,
  enabled: boolean,
  output: AgentSelfPromptPresetEntry[],
  errors: string[],
): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = (await fs.readdir(current, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  } catch (error) {
    errors.push(`无法读取预设目录 ${path.relative(root, current) || "."}: ${errorMessage(error)}`);
    return;
  }
  for (const entry of entries) {
    const absolutePath = path.join(current, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await walkPresetDirectory(root, absolutePath, activePath, enabled, output, errors);
      continue;
    }
    if (!entry.isFile() || !entry.name.toLocaleLowerCase().endsWith(AgentPromptPresetFileExtension)) continue;
    let stat: import("node:fs").Stats;
    try {
      stat = await fs.lstat(absolutePath);
      if (stat.isSymbolicLink() || !stat.isFile()) continue;
    } catch (error) {
      errors.push(`无法读取预设文件 ${path.relative(root, absolutePath)}: ${errorMessage(error)}`);
      continue;
    }
    const relative = path.relative(root, absolutePath).split(path.sep).join("/");
    const portablePath = `${AgentPromptPresetDirectoryPath}/${relative}`;
    output.push({
      path: portablePath,
      sizeBytes: stat.size,
      updatedAt: stat.mtime.toISOString(),
      active: activePath !== undefined && samePortablePath(activePath, portablePath),
      enabled: enabled && activePath !== undefined && samePortablePath(activePath, portablePath),
    });
  }
}

async function readPreset(
  layout: ReturnType<typeof resolveAgentWorkspaceLayout>,
  requestedPath: string,
  maxBytes: number,
): Promise<AgentSelfPromptPresetReadResult> {
  const presetPath = normalizeAgentPromptPresetPath(requestedPath);
  if (!presetPath) {
    return { status: "rejected", error: `预设路径必须是 ${AgentPromptPresetDirectoryPath}/ 下的 Markdown 文件。` };
  }
  const absolutePath = resolvePresetPath(layout, presetPath);
  if (!absolutePath) {
    return { status: "rejected", error: `预设路径不在当前工作区的 ${AgentPromptPresetDirectoryPath}/ 目录内。` };
  }
  try {
    const [canonicalPath, canonicalRoot, stat] = await Promise.all([
      fs.realpath(absolutePath),
      fs.realpath(layout.promptPresetRoot),
      fs.lstat(absolutePath),
    ]);
    if (relativePathWithin(canonicalRoot, canonicalPath) === undefined) {
      return { status: "rejected", error: `预设路径解析后超出 ${AgentPromptPresetDirectoryPath}/ 目录。` };
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return { status: "rejected", error: "预设必须是普通 Markdown 文件。" };
    }
    const content = (await readRegularFile(absolutePath, "Prompt preset", maxBytes)).toString("utf8");
    return { status: "found", path: presetPath, content, sizeBytes: stat.size, updatedAt: stat.mtime.toISOString() };
  } catch (error) {
    return isMissingFileError(error)
      ? { status: "missing", error: `预设不存在: ${presetPath}` }
      : { status: "failed", error: errorMessage(error) };
  }
}

async function setEnabled(
  layout: ReturnType<typeof resolveAgentWorkspaceLayout>,
  requestedPath: string,
  maxBytes: number,
): Promise<AgentSelfPromptPresetMutationResult> {
  const read = await readPreset(layout, requestedPath, maxBytes);
  if (read.status !== "found") return read;
  const manifest: AgentPromptPresetManifest = {
    version: AgentPromptPresetManifestVersion,
    activePath: read.path,
    enabled: true,
  };
  try {
    await writeManifest(layout, manifest);
    return { status: "enabled", enabled: true, activePath: read.path };
  } catch (error) {
    return { status: "failed", error: errorMessage(error) };
  }
}

async function setDisabled(
  layout: ReturnType<typeof resolveAgentWorkspaceLayout>,
  maxBytes: number,
): Promise<AgentSelfPromptPresetMutationResult> {
  const state = await readManifest(layout, maxBytes);
  if (state.error) return { status: "invalid", error: state.error };
  if (!state.manifest) return { status: "missing", error: "当前没有已选择的提示词预设。" };
  try {
    await writeManifest(layout, { ...state.manifest, enabled: false });
    return { status: "disabled", enabled: false, activePath: state.manifest.activePath };
  } catch (error) {
    return { status: "failed", error: errorMessage(error) };
  }
}

async function readManifest(
  layout: ReturnType<typeof resolveAgentWorkspaceLayout>,
  maxBytes: number,
): Promise<{ readonly manifest?: AgentPromptPresetManifest; readonly error?: string }> {
  try {
    const raw = JSON.parse(
      (await readRegularFile(layout.promptPresetStateFile, "Prompt preset state", maxBytes)).toString("utf8"),
    );
    const manifest = parseAgentPromptPresetManifest(raw);
    return manifest ? { manifest } : { error: "提示词预设状态文件不符合当前合同。" };
  } catch (error) {
    if (isMissingFileError(error)) return {};
    return { error: errorMessage(error) };
  }
}

async function writeManifest(
  layout: ReturnType<typeof resolveAgentWorkspaceLayout>,
  manifest: AgentPromptPresetManifest,
): Promise<void> {
  await writeFileAtomic(layout.promptPresetStateFile, `${stringifyAgentCanonicalJson(manifest)}\n`, {
    directoryMode: 0o700,
    mode: 0o600,
  });
}

function resolvePresetPath(
  layout: ReturnType<typeof resolveAgentWorkspaceLayout>,
  presetPath: string,
): string | undefined {
  const absolutePath = path.resolve(layout.root, presetPath);
  return relativePathWithin(layout.promptPresetRoot, absolutePath) === undefined ? undefined : absolutePath;
}

async function inspectPresetRoot(value: string): Promise<{ readonly exists: boolean; readonly error?: string }> {
  try {
    const stat = await fs.lstat(value);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      return { exists: false, error: `预设根目录不是普通目录: ${value}` };
    }
    return { exists: true };
  } catch (error) {
    return isMissingFileError(error) ? { exists: false } : { exists: false, error: errorMessage(error) };
  }
}

async function readRegularFile(filePath: string, subject: string, maxBytes: number): Promise<Buffer> {
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const handle = await fs.open(filePath, constants.O_RDONLY | noFollow);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(`${subject} is not a regular file: ${filePath}`);
    if (stat.size > maxBytes) throw new Error(`${subject} exceeds the ${maxBytes} byte limit: ${filePath}`);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

function samePortablePath(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLocaleLowerCase() === right.toLocaleLowerCase() : left === right;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
