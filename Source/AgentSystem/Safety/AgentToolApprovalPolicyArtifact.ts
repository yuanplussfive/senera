import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const AgentToolApprovalPolicyArtifactContract = Object.freeze({
  schemaVersion: 2,
  entrypoints: Object.freeze({
    toolDecision: "senera/tool/decision",
    executionFallback: "senera/execution/fallback",
  }),
  directorySegments: ["AgentSystem", "Safety"] as const,
  files: Object.freeze({
    policies: ["AgentToolApprovalPolicy.rego", "AgentExecutionFallbackPolicy.rego"] as const,
    data: "AgentToolApprovalPolicy.data.json",
    wasm: "AgentToolApprovalPolicy.wasm",
    manifest: "AgentToolApprovalPolicy.artifact.json",
  }),
});

export const AgentToolApprovalPolicyDataSchema = z
  .object({
    Entrypoints: z
      .object({
        ToolDecision: z.string().min(1),
        ExecutionFallback: z.string().min(1),
      })
      .strict(),
    Reasons: z
      .object({
        ManifestDeny: z.string().min(1),
        ManifestAsk: z.string().min(1),
        ManifestAllow: z.string().min(1),
        MissingTool: z.string().min(1),
        RequiresApproval: z.string().min(1),
        Untrusted: z.string().min(1),
        RiskPermission: z.string().min(1),
        RiskSideEffect: z.string().min(1),
        ToolPermission: z.string().min(1),
        DefaultAllow: z.string().min(1),
        PolicyUnavailable: z.string().min(1),
        EntrypointMismatch: z.string().min(1),
        FallbackStrictSandbox: z.string().min(1),
        FallbackNotAllowed: z.string().min(1),
        FallbackMissingTool: z.string().min(1),
        FallbackUntrusted: z.string().min(1),
        FallbackExternalApproval: z.string().min(1),
        FallbackSystemAllow: z.string().min(1),
        FallbackDefaultDeny: z.string().min(1),
      })
      .strict(),
    HighImpact: z
      .object({
        RiskPermissions: z.array(z.string().min(1)),
        RiskSideEffects: z.array(z.string().min(1)),
        ToolPermissionTerms: z.array(z.string().min(1)),
      })
      .strict(),
    Fallback: z
      .object({
        DenyTrustLevels: z.array(z.string().min(1)),
        ApprovalTrustLevels: z.array(z.string().min(1)),
        AutoAllowTrustLevels: z.array(z.string().min(1)),
      })
      .strict(),
  })
  .strict();

export type AgentToolApprovalPolicyData = z.infer<typeof AgentToolApprovalPolicyDataSchema>;

export const AgentToolApprovalPolicyArtifactManifestSchema = z
  .object({
    schemaVersion: z.literal(AgentToolApprovalPolicyArtifactContract.schemaVersion),
    entrypoints: z.array(z.string().min(1)).min(1),
    compiler: z
      .object({
        name: z.literal("opa"),
        version: z.string().min(1),
      })
      .strict(),
    assets: z
      .object({
        policies: z
          .array(
            z
              .object({
                file: z.string().min(1),
                sha256: Sha256Schema,
              })
              .strict(),
          )
          .min(1),
        data: artifactAssetSchema(AgentToolApprovalPolicyArtifactContract.files.data),
        wasm: artifactAssetSchema(AgentToolApprovalPolicyArtifactContract.files.wasm),
      })
      .strict(),
  })
  .strict();

export type AgentToolApprovalPolicyArtifactManifest = z.infer<typeof AgentToolApprovalPolicyArtifactManifestSchema>;

export interface AgentToolApprovalPolicyArtifactBundle {
  readonly data: AgentToolApprovalPolicyData;
  readonly manifest: AgentToolApprovalPolicyArtifactManifest;
  readonly wasm: Buffer;
}

export function resolveAgentToolApprovalPolicyArtifactDirectory(sourceRoot: string): string {
  return path.join(sourceRoot, ...AgentToolApprovalPolicyArtifactContract.directorySegments);
}

export function readAgentToolApprovalPolicyData(directory: string): AgentToolApprovalPolicyData {
  const dataPath = artifactPath(directory, "data");
  const data = AgentToolApprovalPolicyDataSchema.parse(JSON.parse(fs.readFileSync(dataPath, "utf8")));
  const expectedEntrypoints = AgentToolApprovalPolicyArtifactContract.entrypoints;
  const actualEntrypoints = [data.Entrypoints.ToolDecision, data.Entrypoints.ExecutionFallback];
  if (!sameValues(actualEntrypoints, Object.values(expectedEntrypoints))) {
    throw new Error(`OPA policy data entrypoints do not match the runtime contract.`);
  }
  return data;
}

export function readAgentToolApprovalPolicyArtifact(directory: string): AgentToolApprovalPolicyArtifactBundle {
  const manifestPath = artifactPath(directory, "manifest");
  const manifest = AgentToolApprovalPolicyArtifactManifestSchema.parse(
    JSON.parse(fs.readFileSync(manifestPath, "utf8")),
  );
  assertManifestContract(manifest);

  const dataBuffer = fs.readFileSync(artifactPath(directory, "data"));
  const wasm = fs.readFileSync(artifactPath(directory, "wasm"));
  for (const policy of manifest.assets.policies) {
    assertAssetHash(policy.file, fs.readFileSync(path.join(directory, policy.file)), policy.sha256);
  }
  assertAssetHash("data", dataBuffer, manifest.assets.data.sha256);
  assertAssetHash("wasm", wasm, manifest.assets.wasm.sha256);

  return {
    data: readAgentToolApprovalPolicyData(directory),
    manifest,
    wasm,
  };
}

export function createAgentToolApprovalPolicyArtifactManifest(input: {
  readonly compilerVersion: string;
  readonly policies: readonly { readonly file: string; readonly content: Buffer }[];
  readonly data: Buffer;
  readonly wasm: Buffer;
}): AgentToolApprovalPolicyArtifactManifest {
  return {
    schemaVersion: AgentToolApprovalPolicyArtifactContract.schemaVersion,
    entrypoints: Object.values(AgentToolApprovalPolicyArtifactContract.entrypoints),
    compiler: {
      name: "opa",
      version: input.compilerVersion,
    },
    assets: {
      policies: input.policies.map(({ file, content }) => ({
        file,
        sha256: sha256(content),
      })),
      data: assetManifest("data", input.data),
      wasm: assetManifest("wasm", input.wasm),
    },
  };
}

export function writeAgentToolApprovalPolicyArtifactManifest(
  directory: string,
  manifest: AgentToolApprovalPolicyArtifactManifest,
): void {
  const validated = AgentToolApprovalPolicyArtifactManifestSchema.parse(manifest);
  fs.writeFileSync(artifactPath(directory, "manifest"), `${JSON.stringify(validated, null, 2)}\n`);
}

function artifactAssetSchema(file: string) {
  return z
    .object({
      file: z.literal(file),
      sha256: Sha256Schema,
    })
    .strict();
}

function artifactPath(directory: string, kind: "data" | "wasm" | "manifest"): string {
  return path.join(directory, AgentToolApprovalPolicyArtifactContract.files[kind]);
}

function assetManifest(kind: "data" | "wasm", content: Buffer): { file: string; sha256: string } {
  return {
    file: AgentToolApprovalPolicyArtifactContract.files[kind],
    sha256: sha256(content),
  };
}

function assertManifestContract(manifest: AgentToolApprovalPolicyArtifactManifest): void {
  if (!sameValues(manifest.entrypoints, Object.values(AgentToolApprovalPolicyArtifactContract.entrypoints))) {
    throw new Error("OPA policy artifact entrypoints do not match the runtime contract.");
  }
  if (
    !sameValues(
      manifest.assets.policies.map((policy) => policy.file),
      AgentToolApprovalPolicyArtifactContract.files.policies,
    )
  ) {
    throw new Error("OPA policy artifact sources do not match the runtime contract.");
  }
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  const sortedRight = [...right].sort();
  return left.length === right.length && [...left].sort().every((value, index) => value === sortedRight[index]);
}

function assertAssetHash(kind: string, content: Buffer, expectedHash: string): void {
  const actualHash = sha256(content);
  if (actualHash !== expectedHash) {
    throw new Error(`OPA policy ${kind} hash mismatch: expected ${expectedHash}, got ${actualHash}.`);
  }
}

function sha256(content: Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}
