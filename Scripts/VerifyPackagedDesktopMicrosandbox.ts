import { spawn } from "node:child_process";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DesktopMicrosandboxRuntimeSmokeArgument } from "../Apps/Desktop/DesktopMicrosandboxRuntimeSmoke.js";

const executablePath = resolveExecutablePath(process.argv[2]);
const userDataRoot = await mkdtemp(path.join(os.tmpdir(), "senera-desktop-microsandbox-"));

try {
  const result = await runPackagedDesktopProbe(executablePath, userDataRoot);
  const status = result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.startsWith('{"status":"ok","mode":"desktop-microsandbox"'));
  if (result.exitCode !== 0 || !status) {
    throw new Error(
      `Packaged desktop Microsandbox probe failed with exit code ${result.exitCode}.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  process.stdout.write(`${status}\nPackaged desktop Microsandbox runtime verification passed.\n`);
} finally {
  await rm(userDataRoot, { recursive: true, force: true });
}

function resolveExecutablePath(value: string | undefined): string {
  if (!value?.trim()) throw new Error("Expected the packaged desktop executable path as the first argument.");
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) throw new Error(`Packaged desktop executable does not exist: ${resolved}`);
  return resolved;
}

function runPackagedDesktopProbe(
  executable: string,
  userDataRoot: string,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [DesktopMicrosandboxRuntimeSmokeArgument, `--user-data-dir=${userDataRoot}`], {
      cwd: path.dirname(executable),
      env: { ...process.env },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Packaged desktop Microsandbox probe timed out."));
    }, 180_000);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}
