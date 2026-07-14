import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { SeneraNodeProcessBackend } from "../../../Source/AgentSystem/Execution/SeneraNodeProcessBackend.js";
import type { SeneraProcessExecutionRequest } from "../../../Source/AgentSystem/Execution/SeneraProcessExecutionBackend.js";
import { SeneraExecutionErrorCodes } from "../../../Source/AgentSystem/Execution/SeneraExecutionTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    removeDirectory(temporaryDirectories.pop()!);
  }
});

describe("Node process backend behavior", () => {
  test("executes a Node child with the requested cwd, environment, stdin, and output streams", async () => {
    const cwd = createWorkspace();
    const backend = new SeneraNodeProcessBackend();
    const script = [
      "let stdin = ''",
      "process.stdin.setEncoding('utf8')",
      "process.stdin.on('data', chunk => { stdin += chunk })",
      "process.stdin.on('end', () => {",
      "  process.stdout.write(JSON.stringify({ cwd: process.cwd(), env: process.env.SENERA_BEHAVIOR_TEST, stdin }))",
      "  process.stderr.write('diagnostic')",
      "})",
    ].join(";");

    const result = await backend.executeProcess(
      createRequest({
        cwd,
        args: ["-e", script],
        env: { SENERA_BEHAVIOR_TEST: "forwarded" },
        stdin: "request body",
      }),
    );

    expect(JSON.parse(result.stdout)).toEqual({
      cwd,
      env: "forwarded",
      stdin: "request body",
    });
    expect(result.stderr).toBe("diagnostic");
    expect(result.exitCode).toBe(0);
    expect(result.signal).toBeNull();
  });

  test("reports executable startup failures as structured execution errors", async () => {
    const cwd = createWorkspace();
    const backend = new SeneraNodeProcessBackend();

    await expect(
      backend.executeProcess(
        createRequest({
          cwd,
          command: path.join(cwd, "executable-that-does-not-exist"),
          args: [],
        }),
      ),
    ).rejects.toMatchObject({
      code: SeneraExecutionErrorCodes.SpawnFailed,
      details: expect.objectContaining({ cwd }),
    });
  });

  test("rejects pre-aborted and in-flight requests", async () => {
    const backend = new SeneraNodeProcessBackend();
    const preAborted = new AbortController();
    preAborted.abort();

    await expect(
      backend.executeProcess(
        createRequest({
          cwd: process.cwd(),
          signal: preAborted.signal,
        }),
      ),
    ).rejects.toMatchObject({ code: SeneraExecutionErrorCodes.Aborted });

    const inFlight = new AbortController();
    const execution = backend.executeProcess(
      createRequest({
        cwd: process.cwd(),
        args: ["-e", "setInterval(() => undefined, 1_000)"],
        signal: inFlight.signal,
      }),
    );
    setTimeout(() => inFlight.abort(), 25);

    await expect(execution).rejects.toMatchObject({ code: SeneraExecutionErrorCodes.Aborted });
  });

  test("enforces timeout and independent stdout and stderr byte limits", async () => {
    const backend = new SeneraNodeProcessBackend();

    await expect(
      backend.executeProcess(
        createRequest({
          cwd: process.cwd(),
          args: ["-e", "setInterval(() => undefined, 1_000)"],
          timeoutMs: 25,
        }),
      ),
    ).rejects.toMatchObject({
      code: SeneraExecutionErrorCodes.Timeout,
      details: { timeoutMs: 25 },
    });

    await expect(
      backend.executeProcess(
        createRequest({
          cwd: createWorkspace(),
          args: ["-e", "process.stdout.write('output-over-limit')"],
          limits: { timeoutMs: 5_000, maxStdoutBytes: 4, maxStderrBytes: 1_024 },
        }),
      ),
    ).rejects.toMatchObject({ code: SeneraExecutionErrorCodes.StdoutLimitExceeded });

    await expect(
      backend.executeProcess(
        createRequest({
          cwd: createWorkspace(),
          args: ["-e", "process.stderr.write('error-over-limit')"],
          limits: { timeoutMs: 5_000, maxStdoutBytes: 1_024, maxStderrBytes: 4 },
        }),
      ),
    ).rejects.toMatchObject({ code: SeneraExecutionErrorCodes.StderrLimitExceeded });
  });

  test.each([
    {
      condition: "throws synchronously",
      terminateProcessTree: () => {
        throw new Error("termination threw");
      },
    },
    {
      condition: "fails",
      terminateProcessTree: async () => {
        throw new Error("termination failed");
      },
    },
    {
      condition: "stalls",
      terminateProcessTree: () => new Promise<void>(() => undefined),
    },
  ])("settles a timeout when process-tree termination $condition", async ({ terminateProcessTree }) => {
    const terminator = vi.fn(terminateProcessTree);
    const backend = new SeneraNodeProcessBackend({
      terminateProcessTree: terminator,
      terminationGraceMs: 25,
    });

    await expect(
      backend.executeProcess(
        createRequest({
          cwd: process.cwd(),
          args: ["-e", "setInterval(() => undefined, 1_000)"],
          timeoutMs: 25,
        }),
      ),
    ).rejects.toMatchObject({ code: SeneraExecutionErrorCodes.Timeout });

    expect(terminator).toHaveBeenCalledWith(expect.any(Number), "SIGTERM");
  });

  test("settles concurrent abort and timeout requests", async () => {
    const backend = new SeneraNodeProcessBackend();
    const abortControllers = Array.from({ length: 3 }, () => new AbortController());
    const abortedExecutions = abortControllers.map((controller) =>
      backend.executeProcess(
        createRequest({
          cwd: process.cwd(),
          args: ["-e", "setInterval(() => undefined, 1_000)"],
          signal: controller.signal,
        }),
      ),
    );
    const timedOutExecutions = Array.from({ length: 3 }, () =>
      backend.executeProcess(
        createRequest({
          cwd: process.cwd(),
          args: ["-e", "setInterval(() => undefined, 1_000)"],
          timeoutMs: 25,
        }),
      ),
    );

    setTimeout(() => abortControllers.forEach((controller) => controller.abort()), 25);

    await Promise.all([
      ...abortedExecutions.map((execution) =>
        expect(execution).rejects.toMatchObject({ code: SeneraExecutionErrorCodes.Aborted }),
      ),
      ...timedOutExecutions.map((execution) =>
        expect(execution).rejects.toMatchObject({ code: SeneraExecutionErrorCodes.Timeout }),
      ),
    ]);
  });

  test("refuses local execution when the profile requires sandbox isolation", async () => {
    const backend = new SeneraNodeProcessBackend();

    await expect(
      backend.executeProcess(
        createRequest({
          cwd: createWorkspace(),
          profile: {
            name: "isolated-plugin",
            kind: "plugin-process",
            backend: "sandbox",
            localFallback: "deny",
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: SeneraExecutionErrorCodes.SandboxUnavailable,
      details: { backend: "node-local", profile: "isolated-plugin" },
    });
  });
});

function createRequest(
  overrides: Partial<SeneraProcessExecutionRequest> & Pick<SeneraProcessExecutionRequest, "cwd">,
): SeneraProcessExecutionRequest {
  return {
    command: process.execPath,
    args: ["-e", "process.exit(0)"],
    timeoutMs: 5_000,
    limits: {
      timeoutMs: 5_000,
      maxStdoutBytes: 16 * 1_024,
      maxStderrBytes: 16 * 1_024,
    },
    ...overrides,
  };
}

function createWorkspace(): string {
  const workspace = createTemporaryDirectory("senera-node-process");
  temporaryDirectories.push(workspace);
  return workspace;
}
