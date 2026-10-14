import fs from "node:fs";
import path from "node:path";

export interface AgentBrowserExecutableResolverOptions {
  readonly configuredPath?: string;
  readonly workspaceRoot?: string;
  readonly exists?: (candidate: string) => boolean;
}

export class AgentBrowserExecutableResolutionError extends Error {}

export interface AgentBrowserWindowModeAssertionOptions {
  readonly headed: boolean;
  readonly environment?: NodeJS.ProcessEnv;
}

/**
 * Resolves an explicitly configured browser executable.
 *
 * Browser discovery belongs to the official agent-browser runtime. Keeping
 * that decision in one place lets its supported browser matrix evolve without
 * duplicating platform-specific paths in Senera. This resolver exists only to
 * validate a deliberate executable override before it reaches the CLI.
 */
export function resolveAgentBrowserExecutable(options: AgentBrowserExecutableResolverOptions = {}): string {
  const exists = options.exists ?? fs.existsSync;
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const configured = options.configuredPath?.trim();
  if (!configured) {
    throw new AgentBrowserExecutableResolutionError(
      "No explicit browser executable was configured. Leave runtime.executablePath empty so agent-browser can discover a supported browser.",
    );
  }
  const candidate = path.resolve(workspaceRoot, configured);
  if (exists(candidate)) return candidate;
  throw new AgentBrowserExecutableResolutionError(
    `Configured browser executable is unavailable: ${candidate}. Update the controlled browser executable path.`,
  );
}

/**
 * The production image intentionally has no display server. Fail before
 * agent-browser launches so the user can correct the setting instead of seeing a
 * low-level Chromium startup error.
 */
export function assertAgentBrowserWindowModeSupported({
  headed,
  environment = process.env,
}: AgentBrowserWindowModeAssertionOptions): void {
  if (headed && environment.SENERA_CONTAINER === "1") {
    throw new AgentBrowserExecutableResolutionError(
      "Visible controlled-browser windows are unavailable in the container deployment. Set runtime.headed to false, or run Senera on a desktop host.",
    );
  }
}
