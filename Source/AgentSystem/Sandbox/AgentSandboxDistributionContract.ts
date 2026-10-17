import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { moduleDirPath } from "../Core/AgentPath.js";
import { parseJsonText } from "../Core/AgentJsonParsing.js";

export const AgentSandboxDistributionFormatVersion = 6 as const;

const StableVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/u);
const TargetIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/u);
const DistributionIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/u);
const ImmutableOciReferenceSchema = z.string().regex(/^[^\s@]+@sha256:[a-f0-9]{64}$/u);
const RuntimeOciReferenceSchema = z.string().regex(/^[^\s@]+:[^\s/:]+$/u);
const ToolIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/u);

const AgentSandboxToolProbeSchema = z
  .object({
    id: ToolIdSchema,
    command: z.string().trim().min(1),
    arguments: z.array(z.string()).max(64),
  })
  .strict();

const AgentSandboxDistributionTargetSchema = z
  .object({
    sourceImage: ImmutableOciReferenceSchema,
    runtimeImage: RuntimeOciReferenceSchema,
    registryImage: RuntimeOciReferenceSchema,
    probes: z.array(AgentSandboxToolProbeSchema).min(1).max(64),
  })
  .strict()
  .superRefine((target, context) => {
    const ids = target.probes.map((probe) => probe.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", path: ["probes"], message: "Tool probe ids must be unique." });
    }
  });

export const AgentSandboxDistributionContractSchema = z
  .object({
    formatVersion: z.literal(AgentSandboxDistributionFormatVersion),
    id: DistributionIdSchema,
    version: StableVersionSchema,
    targets: z.record(TargetIdSchema, AgentSandboxDistributionTargetSchema),
  })
  .strict();

export type AgentSandboxDistributionContract = z.infer<typeof AgentSandboxDistributionContractSchema>;
export type AgentSandboxDistributionTarget = z.infer<typeof AgentSandboxDistributionTargetSchema>;
export type AgentSandboxToolProbe = z.infer<typeof AgentSandboxToolProbeSchema>;

export const AgentSandboxRuntimeImageLabels = Object.freeze({
  distributionId: "ai.senera.sandbox.distribution-id",
  distributionVersion: "ai.senera.sandbox.distribution-version",
  target: "ai.senera.sandbox.target",
  sourceImage: "ai.senera.sandbox.source-image",
});

export function resolveAgentSandboxDistributionTarget(
  contract: AgentSandboxDistributionContract = readAgentSandboxDistributionContract(),
  architecture: string = process.arch,
): AgentSandboxDistributionTarget {
  const target = contract.targets[architecture];
  if (!target) {
    throw new Error(`Sandbox distribution ${contract.id} does not publish a runtime image for ${architecture}.`);
  }
  return target;
}

export function readAgentSandboxDistributionContract(): AgentSandboxDistributionContract {
  const contractPath = path.join(moduleDirPath(import.meta.url), "Distribution", "contract.json");
  return AgentSandboxDistributionContractSchema.parse(
    parseJsonText(fs.readFileSync(contractPath, "utf8"), "Sandbox distribution contract"),
  );
}
