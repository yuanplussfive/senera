import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { AgentPersonaPreset, AgentPresetFileRecord, AgentPresetState } from "./AgentPresetTypes.js";
import { parseJsonText } from "../Core/AgentJsonParsing.js";

export interface AgentPresetRepositoryOptions {
  workspaceRoot: string;
  rootDir: string;
  stateFile: string;
}

export interface AgentPresetSaveInput {
  name: string;
  card: AgentPersonaPreset;
}

export class AgentPresetRepository {
  constructor(private readonly options: AgentPresetRepositoryOptions) {}

  get rootDir(): string {
    return this.resolveRootDir();
  }

  async list(): Promise<AgentPresetFileRecord[]> {
    await this.ensureRootDir();
    const rootDir = this.resolveRootDir();
    const entries = await fsp.readdir(rootDir, { withFileTypes: true });
    const records = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.toLocaleLowerCase().endsWith(".json"))
        .map((entry) => this.readFileRecord(entry.name)),
    );
    return records.sort((left, right) => left.name.localeCompare(right.name));
  }

  async read(name: string): Promise<AgentPresetFileRecord> {
    await this.ensureRootDir();
    return this.readFileRecord(this.resolveExistingPresetFileName(name));
  }

  async readOptional(name: string): Promise<AgentPresetFileRecord | null> {
    await this.ensureRootDir();
    try {
      return await this.readFileRecord(this.resolveExistingPresetFileName(name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async save(input: AgentPresetSaveInput): Promise<AgentPresetFileRecord> {
    await this.ensureRootDir();
    const fileName = this.resolveWritablePresetFileName(input.name);
    const filePath = this.resolvePresetFilePath(fileName);
    await fsp.writeFile(filePath, `${JSON.stringify(input.card, null, 2)}\n`, "utf8");
    return this.readFileRecord(fileName);
  }

  async delete(name: string): Promise<void> {
    await this.ensureRootDir();
    const fileName = this.resolveExistingPresetFileName(name);
    await fsp.rm(this.resolvePresetFilePath(fileName), { force: true });
  }

  async readState(): Promise<AgentPresetState> {
    const stateFile = this.resolveStateFile();
    if (!fs.existsSync(stateFile)) {
      return { activePresetName: null };
    }
    const parsed = parseJsonText(await fsp.readFile(stateFile, "utf8"), "Preset state") as Partial<AgentPresetState>;
    return {
      activePresetName: typeof parsed.activePresetName === "string" ? parsed.activePresetName : null,
    };
  }

  async writeState(state: AgentPresetState): Promise<void> {
    const stateFile = this.resolveStateFile();
    await fsp.mkdir(path.dirname(stateFile), { recursive: true });
    await fsp.writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  private async readFileRecord(fileName: string): Promise<AgentPresetFileRecord> {
    const filePath = this.resolvePresetFilePath(fileName);
    const [content, stat] = await Promise.all([fsp.readFile(filePath, "utf8"), fsp.stat(filePath)]);
    return {
      name: fileName,
      path: filePath,
      content,
      sizeBytes: stat.size,
      updatedAt: stat.mtime.toISOString(),
    };
  }

  private async ensureRootDir(): Promise<void> {
    await fsp.mkdir(this.resolveRootDir(), { recursive: true });
  }

  private resolveWritablePresetFileName(name: string): string {
    const fileName = normalizePlainFileName(name);
    return fileName.toLocaleLowerCase().endsWith(".json") ? fileName : `${fileName}.json`;
  }

  private resolveExistingPresetFileName(name: string): string {
    const fileName = normalizePlainFileName(name);
    return fileName.toLocaleLowerCase().endsWith(".json") ? fileName : `${fileName}.json`;
  }

  private resolvePresetFilePath(fileName: string): string {
    const filePath = path.resolve(this.resolveRootDir(), normalizePlainFileName(fileName));
    assertInsideDirectory(this.resolveRootDir(), filePath);
    return filePath;
  }

  private resolveRootDir(): string {
    const rootDir = path.resolve(this.options.workspaceRoot, this.options.rootDir);
    assertInsideDirectory(this.options.workspaceRoot, rootDir);
    return rootDir;
  }

  private resolveStateFile(): string {
    const stateFile = path.resolve(this.options.workspaceRoot, this.options.stateFile);
    assertInsideDirectory(this.options.workspaceRoot, stateFile);
    return stateFile;
  }
}

function normalizePlainFileName(value: string): string {
  const trimmed = value.trim().normalize("NFC");
  const fileName = path.basename(path.posix.basename(path.win32.basename(trimmed)));
  if (!fileName || fileName !== trimmed) {
    throw new Error("预设文件名不能包含目录路径。");
  }
  return fileName;
}

function assertInsideDirectory(directory: string, target: string): void {
  const relative = path.relative(path.resolve(directory), path.resolve(target));
  const [firstSegment] = relative.split(path.sep);
  if (path.isAbsolute(relative) || firstSegment === "..") {
    throw new Error(`预设路径必须位于工作区内：${target}`);
  }
}
