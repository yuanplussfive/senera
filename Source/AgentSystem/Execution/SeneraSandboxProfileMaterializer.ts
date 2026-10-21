import { mkdir } from "node:fs/promises";
import { createSeneraProcessRootfsBundle } from "./SeneraProcessRootfsBundle.js";
import type { SeneraProcessExecutionProfile, SeneraProcessRootfsCopy } from "./SeneraExecutionProfile.js";

export async function prepareSeneraSandboxWritableMounts(
  profile: SeneraProcessExecutionProfile | undefined,
): Promise<void> {
  await Promise.all(
    (profile?.sandbox?.writableMounts ?? []).map((mount) => mkdir(mount.hostPath, { recursive: true })),
  );
}

export async function materializeSeneraSandboxRootfs(
  profile: SeneraProcessExecutionProfile | undefined,
): Promise<{ rootfsCopies: readonly SeneraProcessRootfsCopy[]; cleanup(): void }> {
  const bundles = await Promise.all(
    (profile?.sandbox?.rootfsBundles ?? []).map(async (bundle) => ({
      bundle: await createSeneraProcessRootfsBundle({
        workspaceRoot: bundle.workspaceRoot,
        packageRoot: bundle.packageRoot,
      }),
      guestPath: bundle.guestPath,
    })),
  );
  return {
    rootfsCopies: [
      ...(profile?.sandbox?.rootfsCopies ?? []),
      ...bundles.map(({ bundle, guestPath }) => ({ hostPath: bundle.rootPath, guestPath })),
    ],
    cleanup: () => {
      for (const { bundle } of bundles) bundle.cleanup();
    },
  };
}
