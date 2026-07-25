import {
  readAgentSandboxDistributionContract,
  resolveAgentSandboxDistributionTarget,
} from "../Sandbox/AgentSandboxDistributionContract.js";

export const SeneraMicrosandboxProviderId = "microsandbox";

const sandboxDistribution = readAgentSandboxDistributionContract();
const defaultSandboxTarget = resolveAgentSandboxDistributionTarget(sandboxDistribution);

export const SeneraMicrosandboxDefaults = {
  image: defaultSandboxTarget.sourceImage,
  guestWorkspaceRoot: "/workspace",
  cpus: 2,
  memoryMiB: 1024,
  network: "default",
  pullPolicy: "if-missing",
  sandboxNamePrefix: "senera",
  guestShell: {
    command: "/bin/sh",
    args: ["-lc"],
  },
  stopTimeoutMs: 1_000,
  sandboxNameEntropyLength: 24,
  unavailableRetryDelayMs: 60_000,
} as const;

export type SeneraMicrosandboxNetworkMode = typeof SeneraMicrosandboxDefaults.network | "disabled";

export type SeneraMicrosandboxPullPolicy = typeof SeneraMicrosandboxDefaults.pullPolicy | "always" | "never";

export interface SeneraMicrosandboxSettings {
  image: string;
  guestWorkspaceRoot: string;
  cpus: number;
  memoryMiB: number;
  network: SeneraMicrosandboxNetworkMode;
  pullPolicy: SeneraMicrosandboxPullPolicy;
  sandboxNamePrefix: string;
  guestShell: {
    command: string;
    args: readonly string[];
  };
  stopTimeoutMs: number;
  sandboxNameEntropyLength: number;
  unavailableRetryDelayMs: number;
}

export function resolveSeneraMicrosandboxSettings(
  value: Partial<SeneraMicrosandboxSettings> = {},
): SeneraMicrosandboxSettings {
  return {
    ...SeneraMicrosandboxDefaults,
    ...value,
    guestShell: {
      ...SeneraMicrosandboxDefaults.guestShell,
      ...(value.guestShell ?? {}),
    },
  };
}
