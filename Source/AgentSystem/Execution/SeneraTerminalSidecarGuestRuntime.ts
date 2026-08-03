import fs from "node:fs";
import path from "node:path";
import { SeneraExecutionError, SeneraExecutionErrorCodes } from "./SeneraExecutionTypes.js";
import type { SeneraTerminalSidecarRuntime } from "./SeneraTerminalSidecarRuntime.js";

export const SeneraTerminalSidecarGuestRuntimeDirectoryName = "terminal-sidecar";

const SupportedGuestArchitectures = new Set<NodeJS.Architecture>(["x64", "arm64"]);
const GuestPlatform = "linux";
const GuestRoot = "/opt/senera-terminal";
const GuestNodeCommand = "/usr/local/bin/node";

export function resolveSeneraTerminalSidecarGuestRuntimeRoot(
  sandboxRuntimeBaseDir: string,
  architecture: NodeJS.Architecture = process.arch,
): string {
  assertSupportedGuestArchitecture(architecture);
  return path.join(
    sandboxRuntimeBaseDir,
    SeneraTerminalSidecarGuestRuntimeDirectoryName,
    `${GuestPlatform}-${architecture}`,
  );
}

export function resolvePreparedSeneraTerminalSidecarGuestRuntime(
  sandboxRuntimeBaseDir: string,
  architecture: NodeJS.Architecture = process.arch,
): SeneraTerminalSidecarRuntime {
  const sourceRoot = resolveSeneraTerminalSidecarGuestRuntimeRoot(sandboxRuntimeBaseDir, architecture);
  const packageRoot = path.join(sourceRoot, "node_modules", "@senera", "terminal-sidecar");
  const relativeEntrypoint = path.join("bin", "senera-terminal-sidecar.js");
  const entrypoint = path.join(packageRoot, relativeEntrypoint);
  if (!fs.existsSync(entrypoint)) {
    throw new SeneraExecutionError(
      SeneraExecutionErrorCodes.SandboxUnavailable,
      "Sandbox terminal runtime is not prepared. Run npm run sandbox.prepare before opening a sandbox terminal.",
      {
        backend: "microsandbox-sidecar",
        reason: "terminal_runtime_unprepared",
        runtimeRoot: sourceRoot,
      },
    );
  }

  return {
    sourceRoot,
    packageRoot,
    entrypoint,
    guestRoot: GuestRoot,
    guestEntrypoint: path.posix.join(
      GuestRoot,
      "node_modules",
      "@senera",
      "terminal-sidecar",
      "bin",
      "senera-terminal-sidecar.js",
    ),
    guestNodeCommand: GuestNodeCommand,
  };
}

function assertSupportedGuestArchitecture(architecture: NodeJS.Architecture): void {
  if (SupportedGuestArchitectures.has(architecture)) return;
  throw new SeneraExecutionError(
    SeneraExecutionErrorCodes.SandboxUnavailable,
    `Sandbox terminal runtime does not support architecture ${architecture}.`,
    {
      backend: "microsandbox-sidecar",
      reason: "terminal_architecture_unsupported",
      architecture,
      supportedArchitectures: [...SupportedGuestArchitectures].sort(),
    },
  );
}
