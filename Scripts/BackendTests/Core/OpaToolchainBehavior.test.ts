import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { resolveOpaCompilerBinary, type OpaToolchain } from "../../../Build/OpaToolchain.js";
import { sha256Hex } from "../../../Source/AgentSystem/Core/AgentHash.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("reuses a pinned OPA artifact verified through its open file descriptor", async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-opa-toolchain-"));
  temporaryDirectories.push(workspaceRoot);
  vi.stubEnv("SENERA_OPA_BINARY", "");
  const binary = Buffer.from("verified-opa-artifact", "utf8");
  const fileName = process.platform === "win32" ? "opa.exe" : "opa";
  const toolchain: OpaToolchain = {
    Version: "test-version",
    Artifacts: {
      [`${process.platform}-${process.arch}`]: {
        FileName: fileName,
        Sha256: sha256Hex(binary),
      },
    },
  };
  const artifactPath = path.join(workspaceRoot, ".cache", "opa", toolchain.Version, fileName);
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, binary);
  const fetchSpy = vi.spyOn(globalThis, "fetch");

  await expect(resolveOpaCompilerBinary(workspaceRoot, toolchain)).resolves.toBe(artifactPath);
  expect(fetchSpy).not.toHaveBeenCalled();
});
