import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { SeneraLocalExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import type {
  SeneraProcessExecutionBackend,
  SeneraProcessExecutionRequest,
} from "../../../Source/AgentSystem/Execution/SeneraProcessExecutionBackend.js";
import {
  SeneraExecutionError,
  SeneraExecutionErrorCodes,
} from "../../../Source/AgentSystem/Execution/SeneraExecutionTypes.js";
import {
  createTemporaryDirectory,
  removeDirectory,
} from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    removeDirectory(temporaryDirectories.pop()!);
  }
});

describe("Local execution environment behavior", () => {
  test("performs file operations inside the workspace with structured results", async () => {
    const workspaceRoot = createWorkspace();
    const env = new SeneraLocalExecutionEnv({ workspaceRoot });

    await expect(env.writeFile("notes/release.txt", "alpha\nbeta\ngamma")).resolves.toEqual({ ok: true, value: undefined });
    await expect(env.appendFile("notes/release.txt", "\ndelta")).resolves.toEqual({ ok: true, value: undefined });
    const text = await env.readTextFile("notes/release.txt");
    const lines = await env.readTextLines("notes/release.txt", { maxLines: 2 });
    const binary = await env.readBinaryFile("notes/release.txt");
    const info = await env.fileInfo("notes/release.txt");
    const listing = await env.listDir("notes");
    const canonical = await env.canonicalPath("notes/release.txt");

    expect(text).toEqual({ ok: true, value: "alpha\nbeta\ngamma\ndelta" });
    expect(lines).toEqual({ ok: true, value: ["alpha", "beta"] });
    expect(binary.ok && Buffer.from(binary.value).toString("utf8")).toBe("alpha\nbeta\ngamma\ndelta");
    expect(info).toEqual(expect.objectContaining({
      ok: true,
      value: expect.objectContaining({ name: "release.txt", kind: "file" }),
    }));
    expect(listing).toEqual(expect.objectContaining({
      ok: true,
      value: [expect.objectContaining({ name: "release.txt", kind: "file" })],
    }));
    expect(canonical).toEqual(expect.objectContaining({ ok: true, value: path.join(workspaceRoot, "notes", "release.txt") }));
    await expect(env.exists("notes/release.txt")).resolves.toEqual({ ok: true, value: true });
    await expect(env.remove("notes/release.txt")).resolves.toEqual({ ok: true, value: undefined });
    await expect(env.exists("notes/release.txt")).resolves.toEqual({ ok: true, value: false });
  });

  test("rejects paths and working directories outside the workspace", async () => {
    const workspaceRoot = createWorkspace();
    const env = new SeneraLocalExecutionEnv({ workspaceRoot });
    const outside = path.resolve(workspaceRoot, "..", "outside.txt");

    await expect(env.absolutePath(outside)).resolves.toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code: "permission_denied" }),
    }));
    await expect(env.writeFile(outside, "blocked")).resolves.toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code: "permission_denied" }),
    }));
    await expect(env.executeShell({
      command: "pwd",
      cwd: outside,
      limits: executionLimits(),
    })).rejects.toMatchObject({ code: SeneraExecutionErrorCodes.InvalidWorkspacePath });
  });

  test("honors aborted file requests before touching the filesystem", async () => {
    const workspaceRoot = createWorkspace();
    const env = new SeneraLocalExecutionEnv({ workspaceRoot });
    const controller = new AbortController();
    controller.abort("cancelled");

    await expect(env.writeFile("cancelled.txt", "content", controller.signal)).resolves.toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code: "aborted" }),
    }));
    await expect(env.createDir("cancelled", { abortSignal: controller.signal })).resolves.toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code: "aborted" }),
    }));
    expect(fs.existsSync(path.join(workspaceRoot, "cancelled.txt"))).toBe(false);
  });

  test("delegates shell execution and maps backend errors into Pi execution results", async () => {
    const workspaceRoot = createWorkspace();
    fs.mkdirSync(path.join(workspaceRoot, "nested"), { recursive: true });
    const backend = new RecordingProcessBackend();
    const env = new SeneraLocalExecutionEnv({ workspaceRoot, processBackend: backend });
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await env.exec("echo hello", {
      cwd: "nested",
      timeout: 2,
      env: { TEST_ENV: "1" },
      onStdout: (chunk) => stdout.push(chunk),
      onStderr: (chunk) => stderr.push(chunk),
    });

    expect(result).toEqual({ ok: true, value: { stdout: "hello", stderr: "warning", exitCode: 0 } });
    expect(stdout).toEqual(["hello"]);
    expect(stderr).toEqual(["warning"]);
    expect(backend.requests).toEqual([
      expect.objectContaining({
        command: "test-shell",
        args: ["--command", "echo hello"],
        cwd: path.join(workspaceRoot, "nested"),
        env: { TEST_ENV: "1" },
        timeoutMs: 2_000,
      }),
    ]);

    backend.failure = new SeneraExecutionError(SeneraExecutionErrorCodes.Timeout, "execution timed out");
    const failed = await env.exec("slow command");
    expect(failed).toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code: "timeout", message: "execution timed out" }),
    }));
  });

  test("removes all owned temporary roots during idempotent cleanup", async () => {
    const workspaceRoot = createWorkspace();
    const env = new SeneraLocalExecutionEnv({ workspaceRoot });
    const tempDirectory = await env.createTempDir("senera-env-");
    const tempFile = await env.createTempFile({ prefix: "artifact-", suffix: ".txt" });
    expect(tempDirectory.ok).toBe(true);
    expect(tempFile.ok).toBe(true);
    if (!tempDirectory.ok || !tempFile.ok) {
      throw new Error("Expected local execution temp resources.");
    }
    expect(fs.existsSync(tempDirectory.value)).toBe(true);
    expect(fs.existsSync(tempFile.value)).toBe(true);

    await env.cleanup();
    await env.cleanup();

    expect(fs.existsSync(tempDirectory.value)).toBe(false);
    expect(fs.existsSync(tempFile.value)).toBe(false);
  });
});

class RecordingProcessBackend implements SeneraProcessExecutionBackend {
  readonly kind = "recording";
  readonly requests: SeneraProcessExecutionRequest[] = [];
  failure?: Error;

  resolveShellInvocation(command: string) {
    return { command: "test-shell", args: ["--command", command] };
  }

  async executeProcess(request: SeneraProcessExecutionRequest) {
    this.requests.push(request);
    if (this.failure) {
      throw this.failure;
    }
    return { stdout: "hello", stderr: "warning", exitCode: 0, signal: null };
  }
}

function executionLimits() {
  return {
    timeoutMs: 5_000,
    maxStdoutBytes: 1_024,
    maxStderrBytes: 1_024,
  };
}

function createWorkspace(): string {
  const workspace = createTemporaryDirectory("senera-local-env");
  temporaryDirectories.push(workspace);
  return workspace;
}
