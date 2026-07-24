import { execFile } from "node:child_process";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const MicrosandboxPackageSchema = z
  .object({
    bin: z
      .object({
        msb: z.string().min(1),
      })
      .passthrough(),
  })
  .passthrough();

export interface MicrosandboxDistributionRuntime {
  prepareImage(input: {
    baseDir: string;
    reference: string;
    sandboxName: string;
    pullPolicy: "if-missing" | "never";
    probe: MicrosandboxDistributionProbe;
  }): Promise<void>;
  saveOciImage(input: { baseDir: string; reference: string; outputPath: string }): Promise<void>;
  loadOciImage(input: { baseDir: string; archivePath: string; reference: string }): Promise<void>;
  exportSandboxBundle(input: {
    baseDir: string;
    sandboxName: string;
    snapshotPath: string;
    outputPath: string;
  }): Promise<void>;
  importSandboxBundle(input: { baseDir: string; bundlePath: string }): Promise<void>;
}

export interface MicrosandboxDistributionProbe {
  command: string;
  arguments: readonly string[];
}

export interface MicrosandboxDistributionRuntimeOptions {
  workspaceRoot: string;
  log?: (message: string) => void;
}

export function createMicrosandboxDistributionRuntime(
  options: MicrosandboxDistributionRuntimeOptions,
): MicrosandboxDistributionRuntime {
  const log = options.log ?? (() => undefined);
  let cliPathPromise: Promise<string> | undefined;
  const cliPath = () => (cliPathPromise ??= resolveMicrosandboxCliPath(options.workspaceRoot));
  const run = async (baseDir: string, arguments_: readonly string[]) => {
    await mkdir(baseDir, { recursive: true });
    await runMicrosandboxCli(await cliPath(), options.workspaceRoot, baseDir, arguments_);
  };

  return {
    async prepareImage(input) {
      log(`Preparing sandbox image ${input.reference} with pull policy ${input.pullPolicy}...`);
      await run(input.baseDir, [
        "run",
        "--quiet",
        "--pull",
        input.pullPolicy,
        "--name",
        input.sandboxName,
        "--replace",
        "--no-net",
        "--cpus",
        "1",
        "--memory",
        "256M",
        "--max-duration",
        "60s",
        input.reference,
        "--",
        input.probe.command,
        ...input.probe.arguments,
      ]);
    },

    async saveOciImage(input) {
      await mkdir(path.dirname(input.outputPath), { recursive: true });
      log(`Normalizing sandbox image ${input.reference} into an OCI archive...`);
      await run(input.baseDir, [
        "image",
        "save",
        "--quiet",
        "--format",
        "oci",
        "--output",
        input.outputPath,
        input.reference,
      ]);
    },

    async loadOciImage(input) {
      log(`Loading normalized sandbox image as ${input.reference}...`);
      await run(input.baseDir, ["image", "load", "--quiet", "--input", input.archivePath, "--tag", input.reference]);
    },

    async exportSandboxBundle(input) {
      await mkdir(path.dirname(input.snapshotPath), { recursive: true });
      await mkdir(path.dirname(input.outputPath), { recursive: true });
      log(`Creating sandbox snapshot ${input.snapshotPath}...`);
      await run(input.baseDir, [
        "snapshot",
        "create",
        "--quiet",
        "--integrity",
        "--from",
        input.sandboxName,
        input.snapshotPath,
      ]);
      log(`Exporting sandbox bundle ${input.outputPath}...`);
      await run(input.baseDir, ["snapshot", "export", "--with-image", input.snapshotPath, input.outputPath]);
    },

    async importSandboxBundle(input) {
      log(`Importing sandbox bundle ${input.bundlePath} into a clean runtime...`);
      await run(input.baseDir, ["snapshot", "import", input.bundlePath]);
    },
  };
}

async function resolveMicrosandboxCliPath(workspaceRoot: string): Promise<string> {
  const packageRoot = path.join(workspaceRoot, "node_modules", "microsandbox");
  const packageJsonPath = path.join(packageRoot, "package.json");
  const packageJson = MicrosandboxPackageSchema.parse(JSON.parse(await readFile(packageJsonPath, "utf8")));
  const cliPath = path.resolve(packageRoot, packageJson.bin.msb);
  const relativePath = path.relative(packageRoot, cliPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Microsandbox package declares an out-of-package CLI path: ${packageJson.bin.msb}`);
  }
  const cliStat = await stat(cliPath);
  if (!cliStat.isFile()) throw new Error(`Microsandbox CLI is not a file: ${cliPath}`);
  return cliPath;
}

async function runMicrosandboxCli(
  cliPath: string,
  workspaceRoot: string,
  baseDir: string,
  arguments_: readonly string[],
): Promise<void> {
  try {
    await execFileAsync(process.execPath, [cliPath, ...arguments_], {
      cwd: workspaceRoot,
      encoding: "utf8",
      env: { ...process.env, MSB_HOME: baseDir },
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    const stderr = readProcessErrorOutput(error, "stderr");
    const stdout = readProcessErrorOutput(error, "stdout");
    const detail = stderr || stdout || (error instanceof Error ? error.message : String(error));
    throw new Error(`Microsandbox distribution command failed: ${detail.trim()}`, { cause: error });
  }
}

function readProcessErrorOutput(error: unknown, key: "stdout" | "stderr"): string {
  if (!error || typeof error !== "object" || !(key in error)) return "";
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" ? value : Buffer.isBuffer(value) ? value.toString("utf8") : "";
}
