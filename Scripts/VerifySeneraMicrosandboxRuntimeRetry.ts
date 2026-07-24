import assert from "node:assert/strict";
import { SeneraMicrosandboxDynamicSdkAdapter } from "../Source/AgentSystem/Execution/SeneraMicrosandboxSdkAdapter.js";
import type { SeneraMicrosandboxCreateRequest } from "../Source/AgentSystem/Execution/SeneraMicrosandboxTypes.js";

async function main(): Promise<void> {
  const microsandbox = new FakeMicrosandboxModule();
  let moduleLoads = 0;
  const adapter = new SeneraMicrosandboxDynamicSdkAdapter(() => {
    moduleLoads += 1;
    return Promise.resolve(microsandbox);
  });
  const request = createRequest();

  await assert.rejects(() => adapter.createSandbox(request), /official runtime is not ready/);
  assert.equal(microsandbox.createAttempts, 1);
  assert.equal(moduleLoads, 1);

  const session = await adapter.createSandbox(request);
  assert.equal(microsandbox.createAttempts, 2);
  assert.equal(moduleLoads, 1);
  await session.stop(1_000);

  await adapter.createSandbox(request);
  assert.equal(microsandbox.createAttempts, 3);
  assert.equal(moduleLoads, 1);

  console.log("Senera microsandbox official runtime retry boundary verified.");
}

function createRequest(): SeneraMicrosandboxCreateRequest {
  return {
    name: "senera-retry",
    image: "alpine",
    workspaceRoot: process.cwd(),
    guestWorkspaceRoot: "/workspace",
    workspaceMount: "readonly",
    writableMounts: [],
    guestWorkdir: "/workspace",
    rootfsCopies: [],
    env: {},
    cpus: 1,
    memoryMiB: 512,
    network: "disabled",
    pullPolicy: "if-missing",
    maxDurationSeconds: 30,
  };
}

class FakeMicrosandboxModule {
  createAttempts = 0;
  failNextCreation = true;

  readonly Sandbox = {
    builder: (_name: string) => new FakeSandboxBuilder(this),
  };
}

class FakeSandboxBuilder {
  constructor(private readonly module: FakeMicrosandboxModule) {}

  image(_image: string): this {
    return this;
  }
  cpus(_cpus: number): this {
    return this;
  }
  memory(_memoryMiB: number): this {
    return this;
  }
  pullPolicy(_policy: string): this {
    return this;
  }
  workdir(_workdir: string): this {
    return this;
  }
  envs(_env: Record<string, string>): this {
    return this;
  }
  ephemeral(_enabled: boolean): this {
    return this;
  }
  replace(): this {
    return this;
  }
  disableMetricsSample(): this {
    return this;
  }
  quietLogs(): this {
    return this;
  }
  maxDuration(_seconds: number): this {
    return this;
  }
  disableNetwork(): this {
    return this;
  }

  volume(_path: string, apply: (mount: FakeMount) => FakeMount): this {
    apply(new FakeMount());
    return this;
  }

  patch(apply: (patch: FakeRootfsPatch) => FakeRootfsPatch): this {
    apply(new FakeRootfsPatch());
    return this;
  }

  async create(): Promise<FakeSandbox> {
    this.module.createAttempts += 1;
    if (this.module.failNextCreation) {
      this.module.failNextCreation = false;
      throw new Error("official runtime is not ready");
    }
    return new FakeSandbox();
  }
}

class FakeMount {
  bind(_path: string): this {
    return this;
  }
  nosuid(): this {
    return this;
  }
  nodev(): this {
    return this;
  }
  readonly(): this {
    return this;
  }
  quota(_value: number): this {
    return this;
  }
}

class FakeRootfsPatch {
  copyDir(_hostPath: string, _guestPath: string, _options: { replace: boolean }): this {
    return this;
  }
}

class FakeSandbox {
  async execStreamWith(): Promise<{ recv(): Promise<null> }> {
    return {
      recv: async () => null,
    };
  }

  async stopWithTimeout(_timeoutMs: number): Promise<void> {}
  async kill(): Promise<void> {}
}

await main();
