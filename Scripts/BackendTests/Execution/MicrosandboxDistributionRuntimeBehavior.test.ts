import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { createMicrosandboxDistributionRuntime } from "../../../Build/MicrosandboxDistributionRuntime.js";
import type { AgentMicrosandboxCli } from "../../../Source/AgentSystem/Sandbox/AgentMicrosandboxCli.js";

const SourceReference = "docker.io/library/node@sha256:source";
const RuntimeReference = "senera.local/runtime:test";
const Probe = { command: "node", arguments: ["--version"] } as const;

describe("Microsandbox distribution runtime", () => {
  test("pulls a missing source image through the dedicated image command before probing offline", async () => {
    const fixture = await createRuntimeFixture();
    try {
      await fixture.runtime.prepareImage({
        baseDir: fixture.baseDir,
        reference: SourceReference,
        sandboxName: "source-probe",
        pullPolicy: "if-missing",
        probe: Probe,
      });

      expect(fixture.run.mock.calls).toEqual([
        [fixture.baseDir, ["image", "pull", "--quiet", SourceReference]],
        [fixture.baseDir, expectedProbeArguments("source-probe", SourceReference)],
      ]);
    } finally {
      await fixture.dispose();
    }
  });

  test("probes an imported runtime image without invoking a registry", async () => {
    const fixture = await createRuntimeFixture();
    try {
      await fixture.runtime.prepareImage({
        baseDir: fixture.baseDir,
        reference: RuntimeReference,
        sandboxName: "runtime-probe",
        pullPolicy: "never",
        probe: Probe,
      });

      expect(fixture.run.mock.calls).toEqual([
        [fixture.baseDir, expectedProbeArguments("runtime-probe", RuntimeReference)],
      ]);
    } finally {
      await fixture.dispose();
    }
  });
});

async function createRuntimeFixture() {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), "senera-microsandbox-distribution-"));
  const run = vi.fn(async (_baseDir: string, _arguments: readonly string[]) => undefined);
  const cli = {
    run,
    runWithInput: vi.fn(async () => undefined),
  } satisfies AgentMicrosandboxCli;
  const runtime = createMicrosandboxDistributionRuntime({ workspaceRoot: process.cwd(), cli });
  return {
    baseDir,
    run,
    runtime,
    dispose: () => rm(baseDir, { recursive: true, force: true }),
  };
}

function expectedProbeArguments(sandboxName: string, reference: string): string[] {
  return [
    "run",
    "--quiet",
    "--pull",
    "never",
    "--name",
    sandboxName,
    "--replace",
    "--no-net",
    "--cpus",
    "1",
    "--memory",
    "256M",
    "--max-duration",
    "60s",
    reference,
    "--",
    "node",
    "--version",
  ];
}
