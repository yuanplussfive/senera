import { execFile, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createGunzip } from "node:zlib";
import { z } from "zod";
import { errorMessage } from "../Core/AgentErrors.js";
import { nodeErrorCode } from "../Core/AgentFs.js";
import { parseJsonText } from "../Core/AgentJsonParsing.js";

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
  runWithInput(baseDir: string, arguments_: readonly string[], input: Readable): Promise<void>;
}

export interface AgentMicrosandboxImageArchiveWriter {
  save(input: { baseDir: string; reference: string; outputPath: string }): Promise<void>;
}

export interface AgentMicrosandboxImageArchiveLoader {
  load(input: {
    baseDir: string;
    archivePath: string;
    reference: string;
    compression: "gzip";
    expectedUncompressedBytes: number;
    maxUncompressedBytes: number;
  }): Promise<void>;
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
        const detail = stderr || stdout || errorMessage(error);
        throw new Error(`Microsandbox command failed: ${detail.trim()}`, { cause: error });
      }
    },
    async runWithInput(baseDir, arguments_, input) {
      const microsandboxPackage = await resolvePackage();
      const child = spawn(process.execPath, [microsandboxPackage.cliPath, ...arguments_], {
        cwd: options.cwd,
        env: childProcessEnvironment(baseDir),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      const stdout = collectProcessOutput(child.stdout);
      const stderr = collectProcessOutput(child.stderr);
      const exit = new Promise<number>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => {
          if (signal) {
            reject(new Error(`Microsandbox command terminated by signal ${signal}.`));
            return;
          }
          resolve(code ?? 1);
        });
      });
      let inputError: unknown;
      await Promise.all([
        pipeline(input, child.stdin).catch((error: unknown) => {
          inputError = error;
        }),
        exit.then((code) => {
          if (code === 0) return;
          const detail = stderr() || stdout() || `exit code ${code}`;
          throw new Error(`Microsandbox command failed: ${detail.trim()}`);
        }),
      ]);
      if (inputError) {
        throw new Error(`Unable to stream the Sandbox Bundle into Microsandbox: ${errorMessage(inputError)}`, {
          cause: inputError,
        });
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
      cli.runWithInput(
        input.baseDir,
        ["image", "load", "--quiet", "--tag", input.reference],
        Readable.from(readCompressedArchive(input)),
      ),
  };
}

async function* readCompressedArchive(
  input: Parameters<AgentMicrosandboxImageArchiveLoader["load"]>[0],
): AsyncGenerator<Buffer> {
  const archive = createReadStream(input.archivePath).pipe(createGunzip());
  let uncompressedBytes = 0;
  for await (const value of archive) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    uncompressedBytes += chunk.byteLength;
    if (uncompressedBytes > input.maxUncompressedBytes || uncompressedBytes > input.expectedUncompressedBytes) {
      throw new Error(`Sandbox Bundle expanded beyond its declared OCI archive size: ${input.archivePath}`);
    }
    yield chunk;
  }
  if (uncompressedBytes !== input.expectedUncompressedBytes) {
    throw new Error(
      `Sandbox Bundle expanded to ${uncompressedBytes} bytes; expected ${input.expectedUncompressedBytes}: ${input.archivePath}`,
    );
  }
}

function collectProcessOutput(stream: NodeJS.ReadableStream, maxBytes = 4 * 1024 * 1024): () => string {
  const chunks: Buffer[] = [];
  let retainedBytes = 0;
  stream.on("data", (value: Buffer | string) => {
    if (retainedBytes >= maxBytes) return;
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const retained = chunk.subarray(0, maxBytes - retainedBytes);
    chunks.push(retained);
    retainedBytes += retained.byteLength;
  });
  return () => Buffer.concat(chunks).toString("utf8");
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
    return parseJsonText(await readFile(filePath, "utf8"), "Microsandbox CLI output");
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
