import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";

const OpaArtifactSchema = z
  .object({
    FileName: z.string().min(1),
    Sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

const OpaToolchainSchema = z
  .object({
    Version: z.string().min(1),
    Artifacts: z.record(z.string().min(1), OpaArtifactSchema),
  })
  .strict();

export type OpaToolchain = z.infer<typeof OpaToolchainSchema>;

const OpaReleaseBaseUrl = "https://github.com/open-policy-agent/opa/releases/download";
const OpaCacheDirectory = [".cache", "opa"] as const;

export function readOpaToolchain(workspaceRoot: string): OpaToolchain {
  const filePath = path.join(workspaceRoot, "Build", "OpaToolchain.json");
  return OpaToolchainSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

/**
 * Resolves a pinned OPA compiler without requiring developers or CI runners to
 * install a global binary. The downloaded compiler remains outside source
 * control and is always checked against the toolchain manifest before use.
 */
export async function resolveOpaCompilerBinary(workspaceRoot: string, toolchain: OpaToolchain): Promise<string> {
  const configuredBinary = process.env.SENERA_OPA_BINARY?.trim();
  if (configuredBinary) {
    return configuredBinary;
  }

  const artifact = resolvePlatformArtifact(toolchain);
  const targetPath = path.join(workspaceRoot, ...OpaCacheDirectory, toolchain.Version, artifact.FileName);
  if (isVerifiedArtifact(targetPath, artifact.Sha256)) {
    return targetPath;
  }

  const downloadUrl = `${OpaReleaseBaseUrl}/v${encodeURIComponent(toolchain.Version)}/${encodeURIComponent(artifact.FileName)}`;
  const response = await fetch(downloadUrl, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Unable to download pinned OPA ${toolchain.Version}: HTTP ${response.status}.`);
  }
  if (new URL(response.url).protocol !== "https:") {
    throw new Error("Refusing to install an OPA compiler fetched over an insecure protocol.");
  }

  const binary = Buffer.from(await response.arrayBuffer());
  if (sha256(binary) !== artifact.Sha256) {
    throw new Error(`Pinned OPA ${toolchain.Version} failed SHA-256 verification.`);
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.download`;
  try {
    fs.writeFileSync(temporaryPath, binary, { mode: 0o755 });
    fs.renameSync(temporaryPath, targetPath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
  return targetPath;
}

function resolvePlatformArtifact(toolchain: OpaToolchain): z.infer<typeof OpaArtifactSchema> {
  const platformKey = `${process.platform}-${process.arch}`;
  const artifact = toolchain.Artifacts[platformKey];
  if (!artifact) {
    throw new Error(
      `OPA toolchain does not provide a compiler for ${platformKey}. Set SENERA_OPA_BINARY to a pinned ${toolchain.Version} compiler.`,
    );
  }
  return artifact;
}

function isVerifiedArtifact(filePath: string, expectedSha256: string): boolean {
  try {
    return fs.statSync(filePath).isFile() && sha256(fs.readFileSync(filePath)) === expectedSha256;
  } catch {
    return false;
  }
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
