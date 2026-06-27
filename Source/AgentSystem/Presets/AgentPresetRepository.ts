import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type {
  AgentPresetFileRecord,
  AgentPresetFormat,
  AgentPresetState,
} from "./AgentPresetTypes.js";

export interface AgentPresetRepositoryOptions {
  workspaceRoot: string;
  rootDir: string;
  stateFile: string;
}

export interface AgentPresetSaveInput {
  name: string;
  format: AgentPresetFormat;
  content: string;
}

export class AgentPresetRepository {
  constructor(private readonly options: AgentPresetRepositoryOptions) {}

  get rootDir(): string {
    return this.resolveRootDir();
  }

  async list(): Promise<AgentPresetFileRecord[]> {
    await this.ensureRootDir();
    const rootDir = this.resolveRootDir();
    const stateFile = this.resolveStateFile();
    const entries = await fsp.readdir(rootDir, { withFileTypes: true });
    const records: AgentPresetFileRecord[] = [];

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const filePath = path.resolve(rootDir, entry.name);
      if (filePath === stateFile) {
        continue;
      }
      const format = formatFromFileName(entry.name);
      if (!format) {
        continue;
      }
      records.push(await this.readFileRecord(entry.name));
    }

    return records.sort((left, right) => left.name.localeCompare(right.name));
  }

  async read(name: string): Promise<AgentPresetFileRecord> {
    await this.ensureRootDir();
    return this.readFileRecord(this.resolveExistingPresetFileName(name));
  }

  async save(input: AgentPresetSaveInput): Promise<AgentPresetFileRecord> {
    await this.ensureRootDir();
    const fileName = this.resolveWritablePresetFileName(input.name, input.format);
    const filePath = this.resolvePresetFilePath(fileName);
    await fsp.writeFile(filePath, input.content, "utf8");
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
    const parsed = JSON.parse(await fsp.readFile(stateFile, "utf8")) as Partial<AgentPresetState>;
    return {
      activePresetName: typeof parsed.activePresetName === "string"
        ? parsed.activePresetName
        : null,
    };
  }

  async writeState(state: AgentPresetState): Promise<void> {
    const stateFile = this.resolveStateFile();
    await fsp.mkdir(path.dirname(stateFile), { recursive: true });
    await fsp.writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  private async readFileRecord(fileName: string): Promise<AgentPresetFileRecord> {
    const filePath = this.resolvePresetFilePath(fileName);
    const format = formatFromFileName(fileName);
    if (!format) {
      throw new Error(`不支持的预设文件格式：${fileName}`);
    }
    const [content, stat] = await Promise.all([
      fsp.readFile(filePath, "utf8"),
      fsp.stat(filePath),
    ]);
    return {
      name: fileName,
      path: filePath,
      format,
      content,
      sizeBytes: stat.size,
      updatedAt: stat.mtime.toISOString(),
    };
  }

  private async ensureRootDir(): Promise<void> {
    await fsp.mkdir(this.resolveRootDir(), { recursive: true });
  }

  private resolveWritablePresetFileName(name: string, format: AgentPresetFormat): string {
    const trimmed = name.trim();
    const withExtension = formatFromFileName(trimmed)
      ? trimmed
      : `${trimmed}${extensionForFormat(format)}`;
    const fileName = normalizePlainFileName(withExtension);
    const resolvedFormat = formatFromFileName(fileName);
    if (!resolvedFormat) {
      throw new Error("预设只支持 .json、.md、.txt 文件。");
    }
    if (resolvedFormat !== format) {
      throw new Error(`预设文件扩展名与格式不一致：${fileName}`);
    }
    return fileName;
  }

  private resolveExistingPresetFileName(name: string): string {
    const fileName = normalizePlainFileName(name);
    if (!formatFromFileName(fileName)) {
      throw new Error("预设只支持 .json、.md、.txt 文件。");
    }
    return fileName;
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

export function formatFromFileName(fileName: string): AgentPresetFormat | undefined {
  return PresetFormatByExtension.get(path.extname(fileName).toLowerCase());
}

function extensionForFormat(format: AgentPresetFormat): string {
  return PresetExtensionByFormat[format];
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

const PresetFormatByExtension = new Map<string, AgentPresetFormat>([
  [".json", "json"],
  [".md", "markdown"],
  [".txt", "text"],
]);

const PresetExtensionByFormat = {
  json: ".json",
  markdown: ".md",
  text: ".txt",
} as const satisfies Record<AgentPresetFormat, string>;

