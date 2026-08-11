import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { startSeneraSandboxWorkerProcess, type SeneraSandboxWorkerBootstrap } from "../Apps/SandboxWorkerProcess.js";
import { sleep, withDeadline } from "../Source/AgentSystem/Core/AgentTiming.js";
import { createSeneraExecutionEnvironments } from "../Source/AgentSystem/Execution/SeneraExecutionEnvFactory.js";
import { SeneraShellDialects } from "../Source/AgentSystem/Execution/SeneraShellCommand.js";
import {
  SeneraTerminalCapabilityNames,
  SeneraTerminalCapabilityProviders,
  SeneraTerminalPersistenceScopes,
  type SeneraTerminalChild,
} from "../Source/AgentSystem/Execution/SeneraTerminalTypes.js";
import { resolveAgentSandboxDistributionTarget } from "../Source/AgentSystem/Sandbox/AgentSandboxDistributionContract.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";

const VerificationTimeoutMs = 30_000;
const OutputPollIntervalMs = 25;
const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const temporaryRoot = path.join(projectRoot, ".tmp");

await mkdir(temporaryRoot, { recursive: true });
const workspaceRoot = await mkdtemp(path.join(temporaryRoot, "docker-sandbox-smoke-"));
let worker: SeneraSandboxWorkerBootstrap | undefined;

try {
  await prepareWorkspaceFixture(workspaceRoot);
  const target = resolveAgentSandboxDistributionTarget();
  const config: AgentSystemConfig = {
    ModelProviders: [],
    SandboxRuntime: {
      Enabled: true,
      Provider: "auto",
      BaseDir: path.join(workspaceRoot, ".runtime"),
      Docker: {
        Image: target.runtimeImage,
        PullPolicy: "never",
        PreparationTimeoutSeconds: 120,
      },
    },
  };
  worker = await startSeneraSandboxWorkerProcess({
    workspaceRoot,
    resourcesPath: projectRoot,
    config,
    entrypoint: path.join(projectRoot, "Dist", "Apps", "SandboxWorker.js"),
    startupTimeoutMs: VerificationTimeoutMs,
  });
  if (worker.availability.kind !== "available" || !worker.client) {
    throw new Error("Docker sandbox Worker must be enabled for the real runtime verification.");
  }
  const provider = worker.availability.provider;
  const client = worker.client;
  await client.prepare({ timeoutMs: 120_000 });

  const environments = createSeneraExecutionEnvironments({
    workspaceRoot,
    sandboxAvailable: true,
    sandboxRuntimeReady: () => true,
    sandboxProvider: provider,
    dockerEngineWorker: client,
  });
  const readonlyProfile = sandboxProfile("readonly");
  const writableProfile = sandboxProfile("writable");
  const limits = {
    timeoutMs: VerificationTimeoutMs,
    maxStdoutBytes: 16 * 1024,
    maxStderrBytes: 16 * 1024,
  };

  const visible = await environments.tool.executeShell({
    command:
      "printf '%s\\n' \"$SENERA_SMOKE_ENV\"; git -C . rev-parse --show-toplevel; cat .git/HEAD; cat .senera/runtime-state; printf 'cwd=%s\\n' \"$PWD\"",
    dialect: SeneraShellDialects.Posix,
    cwd: ".",
    env: { SENERA_SMOKE_ENV: "environment-visible" },
    limits,
    profile: readonlyProfile,
  });
  assert.equal(visible.exitCode, 0);
  assert.equal(visible.stderr, "");
  assert.match(
    visible.stdout,
    /^environment-visible\n\/workspace\nref: refs\/heads\/main\nruntime-visible\ncwd=\/workspace\n$/u,
  );

  const denied = await environments.tool.executeShell({
    command: "printf denied > readonly-denied.txt",
    dialect: SeneraShellDialects.Posix,
    cwd: ".",
    limits,
    profile: readonlyProfile,
  });
  assert.notEqual(denied.exitCode, 0, "A read-only workspace mount must reject writes inside the container.");
  await assert.rejects(readFile(path.join(workspaceRoot, "readonly-denied.txt"), "utf8"), { code: "ENOENT" });

  const writable = await environments.tool.executeShell({
    command: "printf 'written-through-docker\\n' > writable-result.txt",
    dialect: SeneraShellDialects.Posix,
    cwd: ".",
    limits,
    profile: writableProfile,
  });
  assert.equal(writable.exitCode, 0);
  assert.equal(await readFile(path.join(workspaceRoot, "writable-result.txt"), "utf8"), "written-through-docker\n");

  await verifyTerminal(
    await environments.tool.spawnTerminal("/bin/sh", ["-i"], {
      cwd: ".",
      columns: 100,
      rows: 24,
      maxDurationMs: VerificationTimeoutMs,
      profile: readonlyProfile,
    }),
  );

  process.stdout.write(`Real Docker Engine shell and PTY verification passed (${provider}).\n`);
} finally {
  await worker?.close().catch(() => undefined);
  await rm(workspaceRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
}

function sandboxProfile(workspaceMount: "readonly" | "writable") {
  return {
    name: `docker-smoke-${workspaceMount}`,
    kind: "shell" as const,
    backend: "sandbox" as const,
    sandbox: {
      workspaceMount,
      network: "disabled" as const,
    },
  };
}

async function prepareWorkspaceFixture(root: string): Promise<void> {
  await execFileAsync("git", ["init", "--quiet", root], { windowsHide: true });
  await execFileAsync("git", ["-C", root, "symbolic-ref", "HEAD", "refs/heads/main"], { windowsHide: true });
  await mkdir(path.join(root, ".senera"), { recursive: true });
  await Promise.all([writeFile(path.join(root, ".senera", "runtime-state"), "runtime-visible\n", "utf8")]);
}

async function verifyTerminal(terminal: SeneraTerminalChild): Promise<void> {
  const chunks: string[] = [];
  let terminalError: Error | undefined;
  let exited = false;
  const dataSubscription = terminal.onData((chunk) => chunks.push(Buffer.from(chunk).toString("utf8")));
  const errorSubscription = terminal.onError((error) => {
    terminalError = error;
  });
  const exit = new Promise<{ exitCode: number; signal?: NodeJS.Signals | number }>((resolve) =>
    terminal.onExit((event) => {
      exited = true;
      resolve(event);
    }),
  );

  try {
    assert.equal(terminal.metadata.effectiveBoundary, "sandbox");
    assert.ok(terminal.metadata.sandboxId);
    assert.equal(terminal.metadata.persistenceScope, SeneraTerminalPersistenceScopes.ExecutionResource);
    assert.equal(
      terminal.metadata.capabilityProviders?.[SeneraTerminalCapabilityNames.Resize],
      SeneraTerminalCapabilityProviders.GuestNodePty,
    );
    assert.equal(
      terminal.metadata.capabilityProviders?.[SeneraTerminalCapabilityNames.Signals],
      SeneraTerminalCapabilityProviders.DockerEngine,
    );

    await terminal.resize?.(132, 40);
    await terminal.write("stty size\n");
    await waitForOutput(chunks, /(?:^|\r?\n)40 132(?:\r?\n|$)/u, () => terminalError);
    await terminal.write(`printf 'senera-pty:%s:%s\\n' "$(id -u)" "$PWD"\n`);
    await waitForOutput(chunks, /senera-pty:[1-9][0-9]*:\/workspace/u, () => terminalError);
    await terminal.write("exit\n");
    const exitEvent = await withDeadline(exit, VerificationTimeoutMs, () => new Error("Docker terminal did not exit."));
    assert.equal(exitEvent.exitCode, 0);
  } finally {
    dataSubscription.dispose();
    errorSubscription.dispose();
    if (!exited) await terminal.signal("kill").catch(() => undefined);
  }
}

async function waitForOutput(
  chunks: readonly string[],
  pattern: RegExp,
  error: () => Error | undefined,
): Promise<void> {
  const startedAt = Date.now();
  while (!pattern.test(chunks.join(""))) {
    const terminalError = error();
    if (terminalError) throw terminalError;
    if (Date.now() - startedAt >= VerificationTimeoutMs) {
      throw new Error(`Timed out waiting for Docker terminal output ${pattern}: ${chunks.join("")}`);
    }
    await sleep(OutputPollIntervalMs);
  }
}
