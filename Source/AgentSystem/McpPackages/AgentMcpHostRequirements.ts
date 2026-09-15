import { z } from "zod";

/** Semantic host capabilities that an MCP package may require before launch. */
export const AgentMcpHostCapabilityNames = {
  InteractiveDesktop: "interactive-desktop",
} as const;

export const AgentMcpHostCapabilitySchema = z.string().trim().min(1);

export const AgentMcpHostRequirementsSchema = z
  .object({
    hostCapabilities: z.array(AgentMcpHostCapabilitySchema).min(1),
  })
  .strict()
  .superRefine((requirements, context) => {
    const duplicateIndex = requirements.hostCapabilities.findIndex(
      (capability, index) => requirements.hostCapabilities.indexOf(capability) !== index,
    );
    if (duplicateIndex >= 0) {
      context.addIssue({
        code: "custom",
        path: ["hostCapabilities", duplicateIndex],
        message: "MCP host capabilities must be unique.",
      });
    }
  });

export type AgentMcpHostCapability = z.infer<typeof AgentMcpHostCapabilitySchema>;
export type AgentMcpHostRequirements = z.infer<typeof AgentMcpHostRequirementsSchema>;

export interface AgentMcpHostCapabilitySnapshot {
  readonly available: ReadonlySet<string>;
  readonly diagnostics: ReadonlyMap<string, string>;
}

export interface AgentMcpHostCapabilityDetectionOptions {
  readonly platform?: NodeJS.Platform;
  readonly environment?: NodeJS.ProcessEnv;
  /** Explicit host knowledge used by embedders and deterministic tests. */
  readonly interactiveDesktop?: boolean;
}

/**
 * Detects capabilities that are safe to evaluate before an MCP process is
 * spawned. The probe is intentionally semantic: package descriptors do not
 * encode operating-system branches or shell commands.
 */
export function detectAgentMcpHostCapabilities(
  options: AgentMcpHostCapabilityDetectionOptions = {},
): AgentMcpHostCapabilitySnapshot {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const probes: readonly AgentMcpHostCapabilityProbe[] = [
    {
      name: AgentMcpHostCapabilityNames.InteractiveDesktop,
      available:
        options.interactiveDesktop ??
        (platform === "linux" ? hasLinuxGraphicalSession(environment) : platform === "win32" || platform === "darwin"),
      unavailableReason:
        platform === "linux"
          ? "Linux requires DISPLAY or WAYLAND_DISPLAY for local desktop control."
          : "The current host does not expose a supported interactive desktop session.",
    },
  ];
  const available = new Set<string>();
  const diagnostics = new Map<string, string>();
  for (const probe of probes) {
    if (probe.available) available.add(probe.name);
    else diagnostics.set(probe.name, probe.unavailableReason);
  }
  return { available, diagnostics };
}

export function missingAgentMcpHostCapabilities(
  requirements: AgentMcpHostRequirements | undefined,
  capabilities: AgentMcpHostCapabilitySnapshot,
): readonly string[] {
  return (requirements?.hostCapabilities ?? []).filter((capability) => !capabilities.available.has(capability));
}

interface AgentMcpHostCapabilityProbe {
  readonly name: string;
  readonly available: boolean;
  readonly unavailableReason: string;
}

function hasLinuxGraphicalSession(environment: NodeJS.ProcessEnv): boolean {
  const x11Display = environment.DISPLAY?.trim();
  const waylandDisplay = environment.WAYLAND_DISPLAY?.trim();
  const runtimeDirectory = environment.XDG_RUNTIME_DIR?.trim();
  return Boolean(x11Display || (waylandDisplay && runtimeDirectory));
}
