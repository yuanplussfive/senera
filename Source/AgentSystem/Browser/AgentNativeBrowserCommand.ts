import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type { AgentBrowserDriverOperationOptions } from "./AgentBrowserDriver.js";

interface AgentBrowserCommandEnvelope {
  readonly success?: boolean;
  readonly data?: unknown;
  readonly error?: unknown;
  readonly code?: unknown;
}

export interface AgentNativeBrowserCommandRequest {
  readonly controller: string;
  readonly command: readonly string[];
  readonly cwd: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly defaultTimeoutMs: number;
  readonly input?: string;
  readonly options: AgentBrowserDriverOperationOptions;
}

export type AgentNativeBrowserCommandExecutor = (request: AgentNativeBrowserCommandRequest) => Promise<unknown>;

export class AgentNativeBrowserCommandError extends Error {
  override name = "AgentNativeBrowserCommandError";

  constructor(
    message: string,
    readonly commandCode?: string,
  ) {
    super(sanitizeAgentBrowserErrorMessage(message));
  }
}

/**
 * The CLI records this timeout in the session launch identity, so a value that
 * changes between commands makes the daemon relaunch the browser and drop the
 * open page. Keep the user's configured default stable for the session;
 * command-specific remaining time is passed through supported CLI arguments.
 */
export function agentBrowserCliEnvironment(
  environment: NodeJS.ProcessEnv | undefined,
  defaultTimeoutMs: number,
): NodeJS.ProcessEnv {
  return agentBrowserCommandEnvironment(environment, defaultTimeoutMs);
}

/**
 * Chromium/Electron hosts export `__COMPAT_LAYER=HighDpiAware`. The CLI forwards
 * its environment to the browser it spawns, and Edge exits immediately without
 * writing DevToolsActivePort when that compatibility layer is inherited.
 */
export function agentBrowserCommandEnvironment(
  environment: NodeJS.ProcessEnv | undefined,
  defaultTimeoutMs?: number,
): NodeJS.ProcessEnv {
  const source = environment ?? process.env;
  const filtered = Object.fromEntries(
    Object.entries(source).filter(([key]) => {
      const normalized = key.toLowerCase();
      return normalized !== "__compat_layer" && normalized !== "agent_browser_default_timeout";
    }),
  );
  return defaultTimeoutMs === undefined
    ? filtered
    : { ...filtered, AGENT_BROWSER_DEFAULT_TIMEOUT: String(defaultTimeoutMs) };
}

export async function executeAgentBrowserCommand({
  controller,
  command,
  cwd,
  environment,
  defaultTimeoutMs,
  input,
  options,
}: AgentNativeBrowserCommandRequest): Promise<unknown> {
  options.signal?.throwIfAborted();
  const child = spawn(controller, command, {
    cwd,
    env: agentBrowserCliEnvironment(environment, defaultTimeoutMs),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const collecting = collectChildOutput(child, options);
  child.stdin.end(input);
  const output = await collecting;
  const envelope = parseEnvelope(output.stdout);
  if (envelope.success === false) {
    const message = typeof envelope.error === "string" ? envelope.error : JSON.stringify(envelope.error);
    throw new AgentNativeBrowserCommandError(
      message || "agent-browser command failed.",
      typeof envelope.code === "string" ? envelope.code : undefined,
    );
  }
  return envelope.data;
}

function collectChildOutput(
  child: ChildProcessByStdio<Writable, Readable, Readable>,
  options: AgentBrowserDriverOperationOptions,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new AgentNativeBrowserCommandError("agent-browser command timed out.", "timeout")));
    }, options.timeoutMs);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => {
      child.kill();
      finish(() => reject(options.signal?.reason ?? new Error("agent-browser command was cancelled.")));
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.split(/\r?\n/gu).some((line) => isJsonEnvelopeLine(line))) {
        child.kill();
        finish(() => resolve({ stdout, stderr }));
      }
    });
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.stdin.once("error", (error) => finish(() => reject(error)));
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => {
      if (code !== 0) {
        finish(() =>
          reject(
            new AgentNativeBrowserCommandError(stderr.trim() || `agent-browser exited with code ${code}.`, undefined),
          ),
        );
        return;
      }
      finish(() => resolve({ stdout, stderr }));
    });
    if (options.signal) {
      if (options.signal.aborted) abort();
      else options.signal.addEventListener("abort", abort, { once: true });
    }
  });
}

function parseEnvelope(stdout: string): AgentBrowserCommandEnvelope {
  const lines = stdout
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean);
  const line = lines.at(-1);
  if (!line) throw new AgentNativeBrowserCommandError("agent-browser returned no JSON response.");
  try {
    const value = JSON.parse(line) as unknown;
    if (!value || typeof value !== "object") throw new Error("response is not an object");
    if (Array.isArray(value)) return { success: true, data: value };
    return value as AgentBrowserCommandEnvelope;
  } catch (error) {
    throw new AgentNativeBrowserCommandError(
      `agent-browser returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function sanitizeAgentBrowserErrorMessage(value: string): string {
  return value.replace(/\b(?:ws|wss):\/\/[^\s"'`]+/giu, "[internal browser endpoint]");
}

function isJsonEnvelopeLine(line: string): boolean {
  const candidate = line.trim();
  if (!candidate.startsWith("{") && !candidate.startsWith("[")) return false;
  try {
    const value = JSON.parse(candidate) as unknown;
    if (Array.isArray(value))
      return value.every((entry: unknown) => entry !== null && typeof entry === "object" && "success" in entry);
    return Boolean(value && typeof value === "object" && ("success" in value || "error" in value));
  } catch {
    return false;
  }
}
