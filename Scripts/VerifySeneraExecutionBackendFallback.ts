import assert from "node:assert/strict";
import {
  SeneraExecutionError,
  SeneraExecutionErrorCodes,
} from "../Source/AgentSystem/Execution/SeneraExecutionTypes.js";
import { decodeSeneraProcessOutput } from "../Source/AgentSystem/Execution/SeneraProcessOutputDecoder.js";
import { SeneraFallbackProcessBackend } from "../Source/AgentSystem/Execution/SeneraFallbackProcessBackend.js";
import { SeneraNodeProcessBackend } from "../Source/AgentSystem/Execution/SeneraNodeProcessBackend.js";
import { SeneraLocalExecutionEnv } from "../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import { resolveSeneraShellInvocation } from "../Source/AgentSystem/Execution/SeneraShellPlatform.js";
import { quoteShellArguments } from "../Source/AgentSystem/Execution/SeneraShellQuoting.js";
import type {
  SeneraProcessExecutionBackend,
  SeneraProcessExecutionRequest,
} from "../Source/AgentSystem/Execution/SeneraProcessExecutionBackend.js";
import iconv from "iconv-lite";

const workspaceRoot = process.cwd();

async function main(): Promise<void> {
  assert.equal(
    quoteShellArguments(["node", "-e", "process.stdout.write('hello world')"]),
    "node -e 'process.stdout.write('\\''hello world'\\'')'",
  );
  assert.equal(
    decodeSeneraProcessOutput(iconv.encode("所在位置 行:1 字符: 15", "gb18030"), { encoding: "auto" }),
    "所在位置 行:1 字符: 15",
  );

  const shell = resolveSeneraShellInvocation("Write-Output 'ok'");
  if (process.platform === "win32") {
    assert.match(shell.command, /^(pwsh|powershell)\.exe$/i);
    assert.ok(shell.args.includes("-NonInteractive"));
    assert.match(shell.args.at(-1) ?? "", /OutputEncoding/);
  }

  const backend = new SeneraFallbackProcessBackend([
    new UnavailableBackend(),
    new SeneraNodeProcessBackend(),
  ]);
  const result = await backend.executeProcess({
    command: process.execPath,
    args: ["-e", "process.stdout.write('fallback-ok')"],
    cwd: workspaceRoot,
    timeoutMs: 5000,
    limits: {
      timeoutMs: 5000,
      maxStdoutBytes: 1024,
      maxStderrBytes: 1024,
    },
  });
  assert.equal(result.stdout, "fallback-ok");
  assert.equal(result.exitCode, 0);

  const shellCalls: string[] = [];
  const shellBackend = new SeneraFallbackProcessBackend([
    new ShellInvocationBackend("sandbox", "sandbox-sh", shellCalls, true),
    new ShellInvocationBackend("local", "local-shell", shellCalls, false),
  ]);
  const env = new SeneraLocalExecutionEnv({
    workspaceRoot,
    processBackend: shellBackend,
  });
  const shellResult = await env.executeShell({
    command: "echo shell-fallback",
    cwd: ".",
    timeoutMs: 5_000,
    limits: {
      timeoutMs: 5_000,
      maxStdoutBytes: 1024,
      maxStderrBytes: 1024,
    },
    profile: {
      name: "verify-shell-fallback",
      kind: "shell",
      backend: "sandbox",
      localFallback: "allow",
    },
  });
  assert.deepEqual(shellCalls, [
    "sandbox:sandbox-sh:-lc echo shell-fallback",
    "local:local-shell:-lc echo shell-fallback",
  ]);
  assert.equal(shellResult.stdout, "local-ok");

  console.log("Senera execution backend fallback verification passed.");
}

class UnavailableBackend implements SeneraProcessExecutionBackend {
  readonly kind = "unavailable";

  async executeProcess(_request: SeneraProcessExecutionRequest): Promise<never> {
    throw new SeneraExecutionError(
      SeneraExecutionErrorCodes.SandboxUnavailable,
      "sandbox unavailable in verification fixture",
    );
  }
}

class ShellInvocationBackend implements SeneraProcessExecutionBackend {
  constructor(
    readonly kind: string,
    private readonly shellCommand: string,
    private readonly calls: string[],
    private readonly unavailable: boolean,
  ) {}

  resolveShellInvocation(command: string) {
    return {
      command: this.shellCommand,
      args: ["-lc", command],
    };
  }

  async executeProcess(request: SeneraProcessExecutionRequest) {
    this.calls.push(`${this.kind}:${request.command}:${request.args.join(" ")}`);
    if (this.unavailable) {
      throw new SeneraExecutionError(
        SeneraExecutionErrorCodes.SandboxUnavailable,
        "sandbox unavailable in shell verification fixture",
      );
    }

    return {
      stdout: "local-ok",
      stderr: "",
      exitCode: 0,
      signal: null,
    };
  }
}

await main();
