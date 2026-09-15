import type { SeneraProcessExecutionProfile, SeneraProcessRootfsCopy } from "./SeneraExecutionProfile.js";
import {
  attachSeneraExecutionDiagnostic,
  normalizeSeneraExecutionDiagnostic,
} from "./SeneraExecutionErrorDiagnostics.js";
import { SeneraExecutionError, SeneraExecutionErrorCodes } from "./SeneraExecutionTypes.js";
import {
  materializeSeneraSandboxRootfs,
  prepareSeneraSandboxWritableMounts,
} from "./SeneraSandboxProfileMaterializer.js";
import { projectSeneraSandboxWorkspaceMount } from "./SeneraSandboxWorkspaceMount.js";

export interface SeneraSandboxCleanupResource {
  diagnosticKey: string;
  reason: string;
  release(): void | Promise<void>;
}

export interface SeneraSandboxExecutionContext {
  guestCwd: string;
  environment: Record<string, string>;
  rootfsCopies: readonly SeneraProcessRootfsCopy[];
  rootfsCleanup: SeneraSandboxCleanupResource;
}

export async function prepareSeneraSandboxExecutionContext(input: {
  workspaceRoot: string;
  cwd: string;
  guestWorkspaceRoot: string;
  guestWorkdir?: string;
  environment?: NodeJS.ProcessEnv;
  profile?: SeneraProcessExecutionProfile;
}): Promise<SeneraSandboxExecutionContext> {
  await prepareSeneraSandboxWritableMounts(input.profile);
  const mount = projectSeneraSandboxWorkspaceMount(input);
  const materialized = await materializeSeneraSandboxRootfs(input.profile);
  return {
    guestCwd: input.guestWorkdir ?? mount.guestCwd,
    environment: projectSeneraSandboxEnvironment(input.environment, input.profile),
    rootfsCopies: materialized.rootfsCopies,
    rootfsCleanup: {
      diagnosticKey: "rootfsCleanup",
      reason: "rootfs_cleanup_failed",
      release: materialized.cleanup,
    },
  };
}

export async function releaseSeneraSandboxResources(
  resources: readonly SeneraSandboxCleanupResource[],
  options: {
    backend: string;
    primaryError?: SeneraExecutionError;
  },
): Promise<void> {
  let failure = options.primaryError;
  for (const resource of resources) {
    try {
      await resource.release();
    } catch (error) {
      const diagnostic = normalizeSeneraExecutionDiagnostic(error, SeneraExecutionErrorCodes.CleanupFailed, {
        backend: options.backend,
        reason: resource.reason,
      });
      failure = failure ? attachSeneraExecutionDiagnostic(failure, resource.diagnosticKey, diagnostic) : diagnostic;
    }
  }
  if (failure) throw failure;
}

export function projectSeneraSandboxEnvironment(
  environment: NodeJS.ProcessEnv | undefined,
  profile: SeneraProcessExecutionProfile | undefined,
): Record<string, string> {
  return {
    ...Object.fromEntries(
      Object.entries(environment ?? {}).filter((entry): entry is [string, string] => entry[1] != null),
    ),
    ...(profile?.sandbox?.env ?? {}),
  };
}
