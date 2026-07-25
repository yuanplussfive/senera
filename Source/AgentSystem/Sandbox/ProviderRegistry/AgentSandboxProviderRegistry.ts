import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { moduleDirPath } from "../../Core/AgentPath.js";
import { AgentSandboxRuntimeProviders, type AgentSandboxRuntimeProvider } from "../AgentSandboxRuntimeTypes.js";

const ProviderSchema = z.enum([
  AgentSandboxRuntimeProviders.Microsandbox,
  AgentSandboxRuntimeProviders.Gvisor,
  AgentSandboxRuntimeProviders.DockerEngine,
]);

export const AgentSandboxProviderRequirementSchema = z.enum(["microsandbox-host", "docker-engine", "registered-runsc"]);

export const AgentSandboxProviderRegistrySchema = z
  .object({
    formatVersion: z.literal(1),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/u),
    candidates: z
      .array(
        z
          .object({
            provider: ProviderSchema,
            platforms: z.array(z.enum(["darwin", "linux", "win32"])).min(1),
            requirements: z.array(AgentSandboxProviderRequirementSchema),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((registry, context) => {
    const providers = registry.candidates.map((candidate) => candidate.provider);
    if (new Set(providers).size !== providers.length) {
      context.addIssue({ code: "custom", path: ["candidates"], message: "Provider candidates must be unique." });
    }
  });

export type AgentSandboxProviderRegistry = z.infer<typeof AgentSandboxProviderRegistrySchema>;
export type AgentSandboxProviderCandidate = AgentSandboxProviderRegistry["candidates"][number];
export type AgentSandboxProviderRequirement = z.infer<typeof AgentSandboxProviderRequirementSchema>;

export function readAgentSandboxProviderRegistry(): AgentSandboxProviderRegistry {
  const contractPath = path.join(moduleDirPath(import.meta.url), "contract.json");
  return AgentSandboxProviderRegistrySchema.parse(JSON.parse(fs.readFileSync(contractPath, "utf8")));
}

export function findAgentSandboxProviderCandidate(
  provider: AgentSandboxRuntimeProvider,
): AgentSandboxProviderCandidate {
  const candidate = readAgentSandboxProviderRegistry().candidates.find((entry) => entry.provider === provider);
  if (!candidate) throw new Error(`Sandbox provider ${provider} is missing from the provider registry.`);
  return candidate;
}
