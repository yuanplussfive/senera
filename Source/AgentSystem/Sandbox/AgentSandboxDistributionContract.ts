import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { moduleDirPath } from "../Core/AgentPath.js";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const StableVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/u);
const TargetIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/u);
const DistributionIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/u);
const ImmutableOciReferenceSchema = z.string().regex(/^[^\s@]+@sha256:[a-f0-9]{64}$/u);
const RuntimeOciReferenceSchema = z.string().regex(/^[^\s@]+:[^\s/:]+$/u);
const SandboxProbeSchema = z
  .object({
    command: z.string().trim().min(1),
    arguments: z.array(z.string()).max(64),
  })
  .strict();
const SafeAssetNameSchema = z
  .string()
  .min(1)
  .refine((value) => path.basename(value) === value && value !== "." && value !== "..", "Invalid asset name.");

const AgentSandboxDistributionTargetSchema = z
  .object({
    sourceImage: ImmutableOciReferenceSchema,
    runtimeImage: RuntimeOciReferenceSchema,
    probe: SandboxProbeSchema,
    bundleAssetName: SafeAssetNameSchema,
  })
  .strict();

export const AgentSandboxDistributionContractSchema = z
  .object({
    formatVersion: z.literal(2),
    id: DistributionIdSchema,
    bundleVersion: StableVersionSchema,
    microsandboxVersion: StableVersionSchema,
    targets: z.record(TargetIdSchema, AgentSandboxDistributionTargetSchema),
    release: z
      .object({
        repositoryUrl: z.url().refine((value) => new URL(value).protocol === "https:", "HTTPS is required."),
        tagTemplate: z.string().includes("{productVersion}"),
        manifestAssetName: SafeAssetNameSchema,
      })
      .strict(),
    downloadPolicy: z
      .object({
        requestTimeoutMs: z.number().int().positive(),
        manifestMaxBytes: z.number().int().positive(),
        bundleMaxBytes: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

export type AgentSandboxDistributionContract = z.infer<typeof AgentSandboxDistributionContractSchema>;
export type AgentSandboxDistributionTarget = z.infer<typeof AgentSandboxDistributionTargetSchema>;

export const AgentSandboxBundleManifestSchema = z
  .object({
    formatVersion: z.literal(2),
    distributionId: DistributionIdSchema,
    bundleVersion: StableVersionSchema,
    productVersion: StableVersionSchema,
    microsandboxVersion: StableVersionSchema,
    target: TargetIdSchema,
    sourceImage: ImmutableOciReferenceSchema,
    runtimeImage: RuntimeOciReferenceSchema,
    asset: z
      .object({
        fileName: SafeAssetNameSchema,
        url: z.url().refine((value) => new URL(value).protocol === "https:", "HTTPS is required."),
        sizeBytes: z.number().int().positive(),
        sha256: Sha256Schema,
      })
      .strict(),
  })
  .strict();

export type AgentSandboxBundleManifest = z.infer<typeof AgentSandboxBundleManifestSchema>;

export interface AgentSandboxReleaseLocation {
  targetId: string;
  target: AgentSandboxDistributionTarget;
  releaseTag: string;
  manifestUrl: string;
  bundleUrl: string;
}

export function resolveAgentSandboxDistributionTarget(
  contract: AgentSandboxDistributionContract,
  architecture: string = process.arch,
): AgentSandboxDistributionTarget {
  const target = contract.targets[architecture];
  if (!target) {
    throw new Error(`Sandbox distribution ${contract.id} does not publish a bundle for ${architecture}.`);
  }
  return target;
}

export function readAgentSandboxDistributionContract(): AgentSandboxDistributionContract {
  const contractPath = path.join(moduleDirPath(import.meta.url), "Distribution", "contract.json");
  return AgentSandboxDistributionContractSchema.parse(JSON.parse(fs.readFileSync(contractPath, "utf8")));
}

export function resolveAgentSandboxReleaseLocation(
  contract: AgentSandboxDistributionContract,
  productVersion: string,
  architecture: string = process.arch,
): AgentSandboxReleaseLocation {
  const normalizedProductVersion = StableVersionSchema.parse(productVersion);
  const target = resolveAgentSandboxDistributionTarget(contract, architecture);
  const releaseTag = contract.release.tagTemplate.replaceAll("{productVersion}", normalizedProductVersion);
  if (releaseTag.includes("{") || releaseTag.includes("}")) {
    throw new Error(`Sandbox release tag template contains an unresolved variable: ${releaseTag}`);
  }
  const releaseRoot = new URL(
    `releases/download/${encodeURIComponent(releaseTag)}/`,
    ensureTrailingSlash(contract.release.repositoryUrl),
  );
  return {
    targetId: architecture,
    target,
    releaseTag,
    manifestUrl: new URL(encodeURIComponent(contract.release.manifestAssetName), releaseRoot).href,
    bundleUrl: new URL(encodeURIComponent(target.bundleAssetName), releaseRoot).href,
  };
}

export function assertAgentSandboxBundleManifest(
  manifest: AgentSandboxBundleManifest,
  contract: AgentSandboxDistributionContract,
  productVersion: string,
  location: AgentSandboxReleaseLocation,
): void {
  const expected = {
    distributionId: contract.id,
    bundleVersion: contract.bundleVersion,
    productVersion,
    microsandboxVersion: contract.microsandboxVersion,
    target: location.targetId,
    sourceImage: location.target.sourceImage,
    runtimeImage: location.target.runtimeImage,
    fileName: location.target.bundleAssetName,
    url: location.bundleUrl,
  };
  const actual = {
    distributionId: manifest.distributionId,
    bundleVersion: manifest.bundleVersion,
    productVersion: manifest.productVersion,
    microsandboxVersion: manifest.microsandboxVersion,
    target: manifest.target,
    sourceImage: manifest.sourceImage,
    runtimeImage: manifest.runtimeImage,
    fileName: manifest.asset.fileName,
    url: manifest.asset.url,
  };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Sandbox bundle manifest does not match distribution contract ${contract.id}.`);
  }
  if (manifest.asset.sizeBytes > contract.downloadPolicy.bundleMaxBytes) {
    throw new Error(`Sandbox bundle exceeds the declared download limit: ${manifest.asset.sizeBytes} bytes.`);
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
