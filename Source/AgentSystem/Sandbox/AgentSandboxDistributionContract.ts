import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { moduleDirPath } from "../Core/AgentPath.js";
import { parseJsonText } from "../Core/AgentJsonParsing.js";

export const AgentSandboxDistributionFormatVersion = 5 as const;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const Sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const StableVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/u);
const TargetIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/u);
const DistributionIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/u);
const ImmutableOciReferenceSchema = z.string().regex(/^[^\s@]+@sha256:[a-f0-9]{64}$/u);
const RuntimeOciReferenceSchema = z.string().regex(/^[^\s@]+:[^\s/:]+$/u);
const AbsolutePosixPathSchema = z
  .string()
  .refine(
    (value) =>
      value !== "/" && !value.includes("\0") && path.posix.isAbsolute(value) && path.posix.normalize(value) === value,
    "Invalid absolute POSIX path.",
  );
const SafeFileNameSchema = z
  .string()
  .min(1)
  .refine((value) => path.basename(value) === value && value !== "." && value !== "..", "Invalid file name.");
const SandboxProbeSchema = z
  .object({
    command: z.string().trim().min(1),
    arguments: z.array(z.string()).max(64),
  })
  .strict();
const OciArchiveSchema = z
  .object({
    format: z.literal("oci"),
    mediaType: z.literal("application/vnd.oci.image.layout.v1.tar"),
    compression: z.literal("gzip"),
    compressedMediaType: z.literal("application/gzip"),
    assetName: SafeFileNameSchema,
  })
  .strict();

const AgentSandboxDistributionTargetSchema = z
  .object({
    sourceImage: ImmutableOciReferenceSchema,
    runtimeImage: RuntimeOciReferenceSchema,
    configDigest: Sha256DigestSchema,
    probe: SandboxProbeSchema,
    archive: OciArchiveSchema,
  })
  .strict();

export const AgentSandboxDistributionContractSchema = z
  .object({
    formatVersion: z.literal(AgentSandboxDistributionFormatVersion),
    id: DistributionIdSchema,
    archiveVersion: StableVersionSchema,
    microsandboxVersion: StableVersionSchema,
    hostRequirements: z
      .object({
        microsandbox: z
          .object({
            linux: z
              .object({
                devices: z
                  .array(
                    z
                      .object({
                        path: AbsolutePosixPathSchema,
                        access: z.array(z.enum(["read", "write"])).min(1),
                      })
                      .strict(),
                  )
                  .min(1),
              })
              .strict(),
          })
          .strict(),
      })
      .strict(),
    targets: z.record(TargetIdSchema, AgentSandboxDistributionTargetSchema),
    bundle: z
      .object({
        manifestFileName: SafeFileNameSchema,
      })
      .strict(),
    limits: z
      .object({
        manifestMaxBytes: z.number().int().positive(),
        bundleMaxBytes: z.number().int().positive(),
        archiveMaxBytes: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

export type AgentSandboxDistributionContract = z.infer<typeof AgentSandboxDistributionContractSchema>;
export type AgentSandboxDistributionTarget = z.infer<typeof AgentSandboxDistributionTargetSchema>;

export const AgentSandboxRuntimeImageLabels = Object.freeze({
  distributionId: "ai.senera.sandbox.distribution-id",
  distributionVersion: "ai.senera.sandbox.distribution-version",
  target: "ai.senera.sandbox.target",
  sourceImage: "ai.senera.sandbox.source-image",
});

export const AgentSandboxArchiveManifestSchema = z
  .object({
    formatVersion: z.literal(AgentSandboxDistributionFormatVersion),
    distributionId: DistributionIdSchema,
    archiveVersion: StableVersionSchema,
    microsandboxVersion: StableVersionSchema,
    target: TargetIdSchema,
    sourceImage: ImmutableOciReferenceSchema,
    runtimeImage: RuntimeOciReferenceSchema,
    configDigest: Sha256DigestSchema,
    asset: z
      .object({
        format: z.literal("oci"),
        mediaType: z.literal("application/vnd.oci.image.layout.v1.tar"),
        compression: z.literal("gzip"),
        compressedMediaType: z.literal("application/gzip"),
        fileName: SafeFileNameSchema,
        sizeBytes: z.number().int().positive(),
        uncompressedSizeBytes: z.number().int().positive(),
        sha256: Sha256Schema,
      })
      .strict(),
  })
  .strict();

export type AgentSandboxArchiveManifest = z.infer<typeof AgentSandboxArchiveManifestSchema>;

export interface AgentSandboxBundleLocation {
  targetId: string;
  target: AgentSandboxDistributionTarget;
  manifestFileName: string;
  archiveFileName: string;
}

export function resolveAgentSandboxDistributionTarget(
  contract: AgentSandboxDistributionContract,
  architecture: string = process.arch,
): AgentSandboxDistributionTarget {
  const target = contract.targets[architecture];
  if (!target) {
    throw new Error(`Sandbox distribution ${contract.id} does not publish an image archive for ${architecture}.`);
  }
  return target;
}

export function readAgentSandboxDistributionContract(): AgentSandboxDistributionContract {
  const contractPath = path.join(moduleDirPath(import.meta.url), "Distribution", "contract.json");
  return AgentSandboxDistributionContractSchema.parse(
    parseJsonText(fs.readFileSync(contractPath, "utf8"), "Sandbox distribution contract"),
  );
}

export function resolveAgentSandboxBundleLocation(
  contract: AgentSandboxDistributionContract,
  architecture: string = process.arch,
): AgentSandboxBundleLocation {
  const target = resolveAgentSandboxDistributionTarget(contract, architecture);
  return {
    targetId: architecture,
    target,
    manifestFileName: contract.bundle.manifestFileName,
    archiveFileName: target.archive.assetName,
  };
}

export function assertAgentSandboxArchiveManifest(
  manifest: AgentSandboxArchiveManifest,
  contract: AgentSandboxDistributionContract,
  architecture: string = process.arch,
): void {
  const location = resolveAgentSandboxBundleLocation(contract, architecture);
  const expected = {
    distributionId: contract.id,
    archiveVersion: contract.archiveVersion,
    microsandboxVersion: contract.microsandboxVersion,
    target: location.targetId,
    sourceImage: location.target.sourceImage,
    runtimeImage: location.target.runtimeImage,
    configDigest: location.target.configDigest,
    format: location.target.archive.format,
    mediaType: location.target.archive.mediaType,
    compression: location.target.archive.compression,
    compressedMediaType: location.target.archive.compressedMediaType,
    fileName: location.archiveFileName,
  };
  const actual = {
    distributionId: manifest.distributionId,
    archiveVersion: manifest.archiveVersion,
    microsandboxVersion: manifest.microsandboxVersion,
    target: manifest.target,
    sourceImage: manifest.sourceImage,
    runtimeImage: manifest.runtimeImage,
    configDigest: manifest.configDigest,
    format: manifest.asset.format,
    mediaType: manifest.asset.mediaType,
    compression: manifest.asset.compression,
    compressedMediaType: manifest.asset.compressedMediaType,
    fileName: manifest.asset.fileName,
  };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Sandbox Bundle manifest does not match distribution contract ${contract.id}.`);
  }
  if (manifest.asset.sizeBytes > contract.limits.bundleMaxBytes) {
    throw new Error(`Sandbox Bundle exceeds the declared compressed size limit: ${manifest.asset.sizeBytes} bytes.`);
  }
  if (manifest.asset.uncompressedSizeBytes > contract.limits.archiveMaxBytes) {
    throw new Error(
      `Sandbox Bundle exceeds the declared uncompressed size limit: ${manifest.asset.uncompressedSizeBytes} bytes.`,
    );
  }
}
