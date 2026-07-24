import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const MicrosandboxPackageSchema = z
  .object({
    name: z.literal("microsandbox"),
    version: z.string().trim().min(1),
    bin: z.union([z.string().trim().min(1), z.record(z.string(), z.string().trim().min(1))]),
  })
  .passthrough();

export interface AgentMicrosandboxPackage {
  rootPath: string;
  version: string;
  cliPath: string;
}

export type AgentMicrosandboxPackageEntryResolver = () => string | Promise<string>;

export interface AgentMicrosandboxCliOptions {
  cwd: string;
  packageEntryResolver?: AgentMicrosandboxPackageEntryResolver;
}

export interface AgentMicrosandboxCli {
  run(baseDir: string, arguments_: readonly string[]): Promise<void>;
}

export interface AgentMicrosandboxImageArchiveWriter {
  save(input: { baseDir: string; reference: string; outputPath: string }): Promise<void>;
}

export interface AgentMicrosandboxImageArchiveLoader {
  load(input: { baseDir: string; archivePath: string; reference: string }): Promise<void>;
}

export interface AgentMicrosandboxImageArchive
  extends AgentMicrosandboxImageArchiveWriter, AgentMicrosandboxImageArchiveLoader {}

export function createAgentMicrosandboxCli(options: AgentMicrosandboxCliOptions): AgentMicrosandboxCli {
  let packagePromise: Promise<AgentMicrosandboxPackage> | undefined;
  const resolvePackage = () => (packagePromise ??= resolveAgentMicrosandboxPackage(options.packageEntryResolver));

  return {
    async run(baseDir, arguments_) {
      const microsandboxPackage = await resolvePackage();
      try {
        await execFileAsync(process.execPath, [microsandboxPackage.cliPath, ...arguments_], {
          cwd: options.cwd,
          encoding: "utf8",
          env: childProcessEnvironment(baseDir),
          maxBuffer: 4 * 1024 * 1024,
          windowsHide: true,
        });
      } catch (error) {
        const stderr = readProcessErrorOutput(error, "stderr");
        const stdout = readProcessErrorOutput(error, "stdout");
        const detail = stderr || stdout || (error instanceof Error ? error.message : String(error));
        throw new Error(`Microsandbox command failed: ${detail.trim()}`, { cause: error });
      }
    },
  };
}

export function createAgentMicrosandboxImageArchive(cli: AgentMicrosandboxCli): AgentMicrosandboxImageArchive {
  return {
    save: (input) =>
      cli.run(input.baseDir, [
        "image",
        "save",
        "--quiet",
        "--format",
        "oci",
        "--output",
        input.outputPath,
        input.reference,
      ]),
    load: (input) =>
      cli.run(input.baseDir, ["image", "load", "--quiet", "--input", input.archivePath, "--tag", input.reference]),
  };
}

export async function resolveAgentMicrosandboxPackage(
  packageEntryResolver: AgentMicrosandboxPackageEntryResolver = () => import.meta.resolve("microsandbox"),
): Promise<AgentMicrosandboxPackage> {
  const entryUrl = await packageEntryResolver();
  const entryPath = fileURLToPath(entryUrl);
  let current = path.dirname(entryPath);

  while (true) {
    const packageJsonPath = path.join(current, "package.json");
    const packageJson = await readOptionalPackageJson(packageJsonPath);
    const parsedPackage = MicrosandboxPackageSchema.safeParse(packageJson);
    if (parsedPackage.success) {
      const manifest = parsedPackage.data;
      const declaredBin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin.msb;
      if (!declaredBin) throw new Error(`Microsandbox package does not declare the msb executable: ${packageJsonPath}`);
      const cliPath = path.resolve(current, declaredBin);
      assertPathInsidePackage(current, cliPath, declaredBin);
      const cliStat = await stat(cliPath);
      if (!cliStat.isFile()) throw new Error(`Microsandbox msb executable is not a file: ${cliPath}`);
      return { rootPath: current, version: manifest.version, cliPath };
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Unable to locate the microsandbox package manifest from ${entryPath}.`);
    }
    current = parent;
  }
}

async function readOptionalPackageJson(filePath: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

function assertPathInsidePackage(packageRoot: string, filePath: string, declaredPath: string): void {
  const relativePath = path.relative(packageRoot, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Microsandbox package declares an out-of-package msb executable: ${declaredPath}`);
  }
}

function childProcessEnvironment(baseDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, MSB_HOME: baseDir };
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
  return env;
}

function readProcessErrorOutput(error: unknown, key: "stdout" | "stderr"): string {
  if (!error || typeof error !== "object" || !(key in error)) return "";
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" ? value : Buffer.isBuffer(value) ? value.toString("utf8") : "";
}

function nodeErrorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}
