import assert from "node:assert/strict";
import path from "node:path";
import { SeneraLocalExecutionEnv } from "../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import {
  SeneraExecutionError,
  SeneraExecutionErrorCodes,
} from "../Source/AgentSystem/Execution/SeneraExecutionTypes.js";
import { SeneraMicrosandboxBackend } from "../Source/AgentSystem/Execution/SeneraMicrosandboxBackend.js";
import type {
  SeneraMicrosandboxCreateRequest,
  SeneraMicrosandboxExecEvent,
  SeneraMicrosandboxExecRequest,
  SeneraMicrosandboxSdkAdapter,
  SeneraMicrosandboxSession,
} from "../Source/AgentSystem/Execution/SeneraMicrosandboxTypes.js";

const workspaceRoot = process.cwd();

async function main(): Promise<void> {
  const sdk = new FakeMicrosandboxSdkAdapter();
  const backend = new SeneraMicrosandboxBackend({
    workspaceRoot,
    sdk,
    sandboxNameFactory: () => "senera-verify",
  });
  const env = new SeneraLocalExecutionEnv({
    workspaceRoot,
    processBackend: backend,
  });

  const result = await env.executeShell({
    command: "pwd",
    cwd: path.join(workspaceRoot, "Source", "AgentSystem"),
    env: {
      SENERA_VERIFY: "1",
      SENERA_EMPTY: undefined,
    },
    limits: {
      timeoutMs: 5_000,
      maxStdoutBytes: 1024,
      maxStderrBytes: 1024,
    },
  });

  assert.equal(result.stdout, "sandbox-ok");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.equal(sdk.createRequests.length, 1);
  assert.equal(sdk.createRequests[0]?.name, "senera-verify");
  assert.equal(sdk.createRequests[0]?.image, "alpine");
  assert.equal(sdk.createRequests[0]?.guestWorkspaceRoot, "/workspace");
  assert.equal(sdk.createRequests[0]?.guestWorkdir, "/workspace/Source/AgentSystem");
  assert.deepEqual(sdk.createRequests[0]?.rootfsCopies, []);
  assert.deepEqual(sdk.createRequests[0]?.env, {});
  assert.equal(sdk.createRequests[0]?.network, "disabled");
  assert.equal(sdk.execRequests[0]?.command, "/bin/sh");
  assert.deepEqual(sdk.execRequests[0]?.args, ["-lc", "pwd"]);
  assert.deepEqual(sdk.execRequests[0]?.env, { SENERA_VERIFY: "1" });

  await backend.executeProcess({
    command: "npm",
    args: ["run", "tool"],
    cwd: path.join(workspaceRoot, "System", "Plugins", "AskUserToolPlugin"),
    env: {
      SENERA_VERIFY: "plugin",
    },
    timeoutMs: 5_000,
    limits: {
      timeoutMs: 5_000,
      maxStdoutBytes: 1024,
      maxStderrBytes: 1024,
    },
    profile: {
      name: "node-plugin",
      kind: "plugin-process",
      microsandbox: {
        image: "node:22-bookworm-slim",
        guestWorkspaceRoot: "/workspace",
        guestWorkdir: "/opt/senera/runtime/System/Plugins/AskUserToolPlugin",
        workspaceMount: "readonly",
        network: "disabled",
        rootfsCopies: [{
          hostPath: path.join(workspaceRoot, "System", "Plugins", "AskUserToolPlugin"),
          guestPath: "/opt/senera/runtime",
        }],
        rootfsBundles: [{
          workspaceRoot,
          packageRoot: path.join(workspaceRoot, "Plugins", "WeatherToolPlugin"),
          guestPath: "/opt/senera/bundles",
        }],
        writableMounts: [{
          hostPath: path.join(workspaceRoot, "Plugins", "WeatherToolPlugin", ".state"),
          guestPath: "/workspace/Plugins/WeatherToolPlugin/.state",
          quotaMiB: 256,
        }],
        env: {
          SENERA_TOOL_CONTEXT_WORKSPACE_ROOT: "/workspace",
          SENERA_TOOL_CONTEXT_PLUGIN_ROOT: "/opt/senera/runtime/System/Plugins/AskUserToolPlugin",
        },
      },
    },
  });
  assert.equal(sdk.createRequests[1]?.image, "node:22-bookworm-slim");
  assert.equal(sdk.createRequests[1]?.guestWorkdir, "/opt/senera/runtime/System/Plugins/AskUserToolPlugin");
  assert.deepEqual(sdk.createRequests[1]?.rootfsCopies, [{
    hostPath: path.join(workspaceRoot, "System", "Plugins", "AskUserToolPlugin"),
    guestPath: "/opt/senera/runtime",
  }, {
    hostPath: sdk.createRequests[1]?.rootfsCopies[1]?.hostPath ?? "",
    guestPath: "/opt/senera/bundles",
  }]);
  assert.match(sdk.createRequests[1]?.rootfsCopies[1]?.hostPath ?? "", /senera-rootfs-bundle-/);
  assert.deepEqual(sdk.createRequests[1]?.env, {
    SENERA_TOOL_CONTEXT_WORKSPACE_ROOT: "/workspace",
    SENERA_TOOL_CONTEXT_PLUGIN_ROOT: "/opt/senera/runtime/System/Plugins/AskUserToolPlugin",
  });
  assert.equal(sdk.execRequests[1]?.cwd, "/opt/senera/runtime/System/Plugins/AskUserToolPlugin");
  assert.deepEqual(sdk.execRequests[1]?.env, {
    SENERA_VERIFY: "plugin",
    SENERA_TOOL_CONTEXT_WORKSPACE_ROOT: "/workspace",
    SENERA_TOOL_CONTEXT_PLUGIN_ROOT: "/opt/senera/runtime/System/Plugins/AskUserToolPlugin",
  });

  const unavailableSdk = new UnavailableMicrosandboxSdkAdapter();
  const unavailableBackend = new SeneraMicrosandboxBackend({
    workspaceRoot,
    sdk: unavailableSdk,
    settings: {
      unavailableRetryDelayMs: 30_000,
    },
    clock: () => 10_000,
  });
  const unavailableRequest = {
    command: "/bin/sh",
    args: ["-lc", "true"],
    cwd: workspaceRoot,
    timeoutMs: 5_000,
    limits: {
      timeoutMs: 5_000,
      maxStdoutBytes: 1024,
      maxStderrBytes: 1024,
    },
  };
  await assert.rejects(
    () => unavailableBackend.executeProcess(unavailableRequest),
    (error: unknown) =>
      error instanceof SeneraExecutionError
      && error.code === SeneraExecutionErrorCodes.SandboxUnavailable,
  );
  await assert.rejects(
    () => unavailableBackend.executeProcess(unavailableRequest),
    (error: unknown) =>
      error instanceof SeneraExecutionError
      && error.code === SeneraExecutionErrorCodes.SandboxUnavailable,
  );
  assert.equal(unavailableSdk.createCount, 1);

  await assert.rejects(
    () => new SeneraMicrosandboxBackend({
      workspaceRoot,
      sdk: new UnavailableMicrosandboxSdkAdapter(),
    }).executeProcess({
      command: "/bin/sh",
      args: ["-lc", "true"],
      cwd: workspaceRoot,
      timeoutMs: 5_000,
      limits: {
        timeoutMs: 5_000,
        maxStdoutBytes: 1024,
        maxStderrBytes: 1024,
      },
    }),
    (error: unknown) =>
      error instanceof SeneraExecutionError
      && error.code === SeneraExecutionErrorCodes.SandboxUnavailable,
  );

  const limitSession = new FakeMicrosandboxSession([
    { kind: "stdout", data: Buffer.from("too-large") },
  ]);
  await assert.rejects(
    () => new SeneraMicrosandboxBackend({
      workspaceRoot,
      sdk: new FakeMicrosandboxSdkAdapter(limitSession),
    }).executeProcess({
      command: "/bin/sh",
      args: ["-lc", "echo too-large"],
      cwd: workspaceRoot,
      timeoutMs: 5_000,
      limits: {
        timeoutMs: 5_000,
        maxStdoutBytes: 3,
        maxStderrBytes: 1024,
      },
    }),
    (error: unknown) =>
      error instanceof SeneraExecutionError
      && error.code === SeneraExecutionErrorCodes.StdoutLimitExceeded,
  );
  assert.equal(limitSession.killCount, 1);

  console.log("Senera microsandbox backend verification passed.");
}

class FakeMicrosandboxSdkAdapter implements SeneraMicrosandboxSdkAdapter {
  readonly createRequests: SeneraMicrosandboxCreateRequest[] = [];
  readonly execRequests: SeneraMicrosandboxExecRequest[] = [];

  constructor(private readonly session = new FakeMicrosandboxSession([
    { kind: "stdout", data: Buffer.from("sandbox-ok") },
    { kind: "exit", code: 0 },
  ])) {}

  async isInstalled(): Promise<boolean> {
    return true;
  }

  async createSandbox(request: SeneraMicrosandboxCreateRequest): Promise<SeneraMicrosandboxSession> {
    this.createRequests.push(request);
    return {
      exec: (execRequest) => {
        this.execRequests.push(execRequest);
        return this.session.exec(execRequest);
      },
      stop: (timeoutMs) => this.session.stop(timeoutMs),
      kill: () => this.session.kill(),
    };
  }
}

class UnavailableMicrosandboxSdkAdapter implements SeneraMicrosandboxSdkAdapter {
  createCount = 0;

  async isInstalled(): Promise<boolean> {
    return false;
  }

  async createSandbox(_request: SeneraMicrosandboxCreateRequest): Promise<SeneraMicrosandboxSession> {
    this.createCount += 1;
    throw new Error("unreachable");
  }
}

class FakeMicrosandboxSession implements SeneraMicrosandboxSession {
  killCount = 0;
  stopCount = 0;

  constructor(private readonly events: readonly SeneraMicrosandboxExecEvent[]) {}

  async *exec(_request: SeneraMicrosandboxExecRequest): AsyncIterable<SeneraMicrosandboxExecEvent> {
    yield* this.events;
  }

  async stop(_timeoutMs: number): Promise<void> {
    this.stopCount += 1;
  }

  async kill(): Promise<void> {
    this.killCount += 1;
  }
}

await main();
