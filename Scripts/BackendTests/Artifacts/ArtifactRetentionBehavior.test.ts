import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentArtifactRetentionService } from "../../../Source/AgentSystem/Artifacts/AgentArtifactRetentionService.js";
import { resolveArtifactsConfig } from "../../../Source/AgentSystem/Defaults/AgentAppDefaults.js";
import {
  createSeneraOutputSpool,
  updateSeneraOutputSpoolState,
} from "../../../Source/AgentSystem/Execution/SeneraOutputSpool.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentSystemConfigTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) removeDirectory(temporaryDirectories.pop()!);
});

describe("artifact retention", () => {
  test("removes expired partial output and the oldest complete artifact when the count quota is exceeded", async () => {
    const fixture = createFixture({ MaxArtifacts: 3 });
    const oldest = await createArtifact(fixture.root, "oldest", "session-a", "2025-01-01T00:00:00.000Z");
    const middle = await createArtifact(fixture.root, "middle", "session-a", "2025-01-02T00:00:00.000Z");
    const newest = await createArtifact(fixture.root, "newest", "session-b", "2025-01-03T00:00:00.000Z");
    const stalePartial = await createPartialArtifact(fixture.root, "stale-partial", Date.now() - 2 * 3_600_000);
    const freshPartial = await createPartialArtifact(fixture.root, "fresh-partial", Date.now());

    const report = await fixture.service.cleanup();

    await expect(fs.stat(oldest)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(stalePartial)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(middle)).resolves.toBeDefined();
    await expect(fs.stat(newest)).resolves.toBeDefined();
    await expect(fs.stat(freshPartial)).resolves.toBeDefined();
    expect(report).toMatchObject({
      scannedArtifacts: 3,
      scannedIncompleteDirectories: 2,
      retainedArtifacts: 2,
      removedArtifacts: 1,
      removedIncompleteDirectories: 1,
    });
  });

  test("removes only artifacts owned by the deleted session", async () => {
    const fixture = createFixture();
    const removed = await createArtifact(fixture.root, "session-a", "session-a", "2026-01-01T00:00:00.000Z");
    const retained = await createArtifact(fixture.root, "session-b", "session-b", "2026-01-01T00:00:00.000Z");

    const report = await fixture.service.removeSessionArtifacts("session-a");

    await expect(fs.stat(removed)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(retained)).resolves.toBeDefined();
    expect(report).toMatchObject({ reason: "session", removedArtifacts: 1, retainedArtifacts: 1 });
  });

  test("counts fresh partial artifacts in quota reports and supports dry-run inspection", async () => {
    const fixture = createFixture({ MaxArtifacts: 1 });
    const complete = await createArtifact(fixture.root, "complete", "session-a", "2026-01-01T00:00:00.000Z");
    const partial = await createPartialArtifact(fixture.root, "partial", Date.now(), "session-a");

    const report = await fixture.service.inspect();

    expect(report).toMatchObject({ dryRun: true, removedArtifacts: 1, retainedIncompleteDirectories: 1 });
    await expect(fs.stat(complete)).resolves.toBeDefined();
    await expect(fs.stat(partial)).resolves.toBeDefined();

    await fixture.service.removeSessionArtifacts("session-a");
    await expect(fs.stat(complete)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(partial)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("reclaims committed and stale failed output spools", async () => {
    const fixture = createFixture();
    const spoolRoot = path.join(fixture.root, ".spool");
    const committed = await createSeneraOutputSpool(spoolRoot, "committed", {
      metadata: { sessionId: "session-a", requestId: "request-a" },
    });
    committed.write("stdout", Buffer.from("committed output"));
    await committed.close();
    await updateSeneraOutputSpoolState(committed.descriptor, "committed");

    const failed = await createSeneraOutputSpool(spoolRoot, "failed", {
      metadata: { sessionId: "session-a", requestId: "request-b" },
    });
    failed.write("stderr", Buffer.from("failed output"));
    await failed.close();
    await updateSeneraOutputSpoolState(failed.descriptor, "failed");
    const staleMarker = path.join(failed.descriptor.directory, ".output-spool.json");
    const staleDate = new Date(Date.now() - 2 * 3_600_000);
    await fs.utimes(staleMarker, staleDate, staleDate);

    const report = await fixture.service.cleanup();

    await expect(fs.stat(committed.descriptor.directory)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(failed.descriptor.directory)).rejects.toMatchObject({ code: "ENOENT" });
    expect(report).toMatchObject({ scannedSpools: 2, removedSpools: 2, retainedSpools: 0 });
  });

  test("reclaims non-active spools when only the byte quota is exceeded", async () => {
    const fixture = createFixture({ MaxStoredBytes: 1 });
    const spool = await createSeneraOutputSpool(path.join(fixture.root, ".spool"), "sealed", {
      metadata: { sessionId: "session-a", requestId: "request-a" },
    });
    spool.write("stdout", Buffer.from("quota pressure"));
    await spool.close();

    const report = await fixture.service.cleanup();

    await expect(fs.stat(spool.descriptor.directory)).rejects.toMatchObject({ code: "ENOENT" });
    expect(report).toMatchObject({ removedSpools: 1, retainedSpools: 0 });
  });

  test("never quota-evicts an active spool", async () => {
    const fixture = createFixture({ MaxStoredBytes: 1 });
    const spool = await createSeneraOutputSpool(path.join(fixture.root, ".spool"), "active", {
      metadata: { sessionId: "session-a", requestId: "request-a" },
    });
    spool.write("stdout", Buffer.from("active output"));

    const report = await fixture.service.cleanup();

    await expect(fs.stat(spool.descriptor.directory)).resolves.toBeDefined();
    expect(report).toMatchObject({ removedSpools: 0, retainedSpools: 1 });
    await spool.cleanup();
  });
});

function createFixture(overrides: Partial<ReturnType<typeof resolveArtifactsConfig>> = {}) {
  const workspaceRoot = createTemporaryDirectory("senera-artifact-retention");
  temporaryDirectories.push(workspaceRoot);
  const config = {
    ...resolveArtifactsConfig({ ModelProviders: [] } satisfies AgentSystemConfig),
    RootDir: ".senera/artifacts/runs",
    MaxStoredBytes: Number.MAX_SAFE_INTEGER,
    MaxArtifacts: 100,
    RetentionHours: 1_000_000,
    IncompleteRetentionHours: 1,
    MaintenanceIntervalMinutes: 60,
    ...overrides,
  };
  return {
    root: path.join(workspaceRoot, config.RootDir),
    service: new AgentArtifactRetentionService({ workspaceRoot, config: () => config }),
  };
}

async function createArtifact(root: string, name: string, sessionId: string, createdAt: string): Promise<string> {
  const directory = path.join(root, name);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "payload.txt"), name.repeat(16), "utf8");
  await fs.writeFile(
    path.join(directory, "manifest.json"),
    JSON.stringify({
      schemaVersion: 2,
      artifactId: name,
      artifactUri: `senera://artifact/${name}`,
      sessionId,
      createdAt,
    }),
    "utf8",
  );
  return directory;
}

async function createPartialArtifact(
  root: string,
  name: string,
  modifiedAt: number,
  sessionId?: string,
): Promise<string> {
  const directory = path.join(root, name);
  await fs.mkdir(directory, { recursive: true });
  const marker = path.join(directory, ".artifact-writing");
  await fs.writeFile(
    marker,
    JSON.stringify({ sessionId, state: "writing", startedAt: new Date(modifiedAt).toISOString() }),
    "utf8",
  );
  const date = new Date(modifiedAt);
  await fs.utimes(marker, date, date);
  return directory;
}
