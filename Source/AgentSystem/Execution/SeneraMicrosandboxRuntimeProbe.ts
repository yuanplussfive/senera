import type { SeneraMicrosandboxBackend } from "./SeneraMicrosandboxBackend.js";
import { SeneraShellDialects } from "./SeneraShellCommand.js";
import {
  SeneraTerminalCapabilityNames,
  SeneraTerminalCapabilityProviders,
  SeneraTerminalPersistenceScopes,
} from "./SeneraTerminalTypes.js";

export interface SeneraMicrosandboxRuntimeProbeResult {
  readonly processOutput: string;
  readonly terminalOutput: string;
  readonly resizeProvider: string;
  readonly persistenceScope: string;
}

export async function probeSeneraMicrosandboxRuntime(
  backend: SeneraMicrosandboxBackend,
  workspaceRoot: string,
  timeoutMs = 30_000,
): Promise<SeneraMicrosandboxRuntimeProbeResult> {
  const processResult = await backend.executeProcess({
    command: "/bin/sh",
    args: ["-lc", "printf 'real-sandbox-ok\\n'; printf '%s\\n' \"$SENERA_SMOKE_ENV\""],
    cwd: workspaceRoot,
    env: { SENERA_SMOKE_ENV: "environment-ok" },
    timeoutMs,
    limits: { timeoutMs, maxStdoutBytes: 4_096, maxStderrBytes: 4_096 },
  });
  if (
    processResult.stdout !== "real-sandbox-ok\nenvironment-ok\n" ||
    processResult.stderr !== "" ||
    processResult.exitCode !== 0
  ) {
    throw new Error(`Microsandbox process probe returned an unexpected result: ${JSON.stringify(processResult)}`);
  }

  const terminal = await backend.spawn("/bin/sh", ["-i"], {
    cwd: workspaceRoot,
    columns: 100,
    rows: 24,
    maxDurationMs: timeoutMs,
  });
  const chunks: string[] = [];
  const exit = new Promise<{ exitCode: number; signal?: NodeJS.Signals | number }>((resolve) =>
    terminal.onExit(resolve),
  );
  const data = terminal.onData((chunk) => chunks.push(Buffer.from(chunk).toString("utf8")));
  try {
    await terminal.resize?.(132, 40);
    await terminal.write(`stty size${"\n"}`);
    await waitForOutput(chunks, /40 132/u, timeoutMs);
    await terminal.write(`printf real-pty-ok${"\n"}`);
    await waitForOutput(chunks, /real-pty-ok/u, timeoutMs);
    await terminal.write(`exit${"\n"}`);
    const exitEvent = await Promise.race([exit, timeout(timeoutMs, "Microsandbox terminal did not exit.")]);
    if (exitEvent.exitCode !== 0) {
      throw new Error(`Microsandbox terminal exited with code ${exitEvent.exitCode}.`);
    }

    const terminalOutput = chunks.join("");
    if (!/40 132/u.test(terminalOutput) || !/real-pty-ok/u.test(terminalOutput)) {
      throw new Error(`Microsandbox terminal probe returned unexpected output: ${terminalOutput}`);
    }
    const resizeProvider = terminal.metadata.capabilityProviders?.[SeneraTerminalCapabilityNames.Resize];
    if (terminal.metadata.shellDialect !== SeneraShellDialects.Posix) {
      throw new Error(`Microsandbox terminal reported an unexpected shell dialect: ${terminal.metadata.shellDialect}`);
    }
    if (terminal.metadata.persistenceScope !== SeneraTerminalPersistenceScopes.ExecutionResource) {
      throw new Error(
        `Microsandbox terminal reported an unexpected persistence scope: ${terminal.metadata.persistenceScope}`,
      );
    }
    if (resizeProvider !== SeneraTerminalCapabilityProviders.GuestNodePty) {
      throw new Error(`Microsandbox terminal reported an unexpected resize provider: ${resizeProvider}`);
    }

    return {
      processOutput: processResult.stdout,
      terminalOutput,
      resizeProvider,
      persistenceScope: terminal.metadata.persistenceScope,
    };
  } finally {
    data.dispose();
    await terminal.signal("kill").catch(() => undefined);
  }
}

async function waitForOutput(chunks: readonly string[], pattern: RegExp, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (!pattern.test(chunks.join(""))) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Timed out waiting for terminal output: ${pattern}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function timeout(milliseconds: number, message: string): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), milliseconds));
}
