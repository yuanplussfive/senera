import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test, vi } from "vitest";
import {
  createAgentMicrosandboxImageArchive,
  resolveAgentMicrosandboxPackage,
  type AgentMicrosandboxCli,
} from "../../../Source/AgentSystem/Sandbox/AgentMicrosandboxCli.js";

describe("microsandbox image archive CLI", () => {
  test("resolves the official CLI exclusively from package metadata", async () => {
    const root = await createPackageFixture({ bin: { msb: "bin/official-cli.cjs" } });
    try {
      const resolved = await resolveAgentMicrosandboxPackage(
        () => pathToFileURL(path.join(root, "dist", "index.js")).href,
      );
      expect(resolved).toEqual({
        rootPath: root,
        version: "0.6.4",
        cliPath: path.join(root, "bin", "official-cli.cjs"),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects a package CLI declaration that escapes the package root", async () => {
    const root = await createPackageFixture({ bin: { msb: "../outside.cjs" }, createCli: false });
    try {
      await expect(
        resolveAgentMicrosandboxPackage(() => pathToFileURL(path.join(root, "dist", "index.js")).href),
      ).rejects.toThrow("out-of-package msb executable");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("maps OCI save and load operations to the official image commands", async () => {
    const run = vi.fn(async () => undefined);
    const archive = createAgentMicrosandboxImageArchive({ run } satisfies AgentMicrosandboxCli);

    await archive.save({ baseDir: "source", reference: "registry/image@sha256:digest", outputPath: "image.tar" });
    await archive.load({ baseDir: "target", archivePath: "image.tar", reference: "local/image:version" });

    expect(run.mock.calls).toEqual([
      [
        "source",
        ["image", "save", "--quiet", "--format", "oci", "--output", "image.tar", "registry/image@sha256:digest"],
      ],
      ["target", ["image", "load", "--quiet", "--input", "image.tar", "--tag", "local/image:version"]],
    ]);
  });
});

async function createPackageFixture(options: {
  bin: string | Record<string, string>;
  createCli?: boolean;
}): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "senera-microsandbox-package-"));
  await mkdir(path.join(root, "dist"), { recursive: true });
  await writeFile(path.join(root, "dist", "index.js"), "export {};\n", "utf8");
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "microsandbox", version: "0.6.4", bin: options.bin }, null, 2)}\n`,
    "utf8",
  );
  if (options.createCli !== false) {
    const declared = typeof options.bin === "string" ? options.bin : options.bin.msb;
    if (declared) {
      const cliPath = path.resolve(root, declared);
      await mkdir(path.dirname(cliPath), { recursive: true });
      await writeFile(cliPath, "#!/usr/bin/env node\n", "utf8");
    }
  }
  return root;
}
