import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scopeAgentWorkspaceUrl } from "../WorkspaceResources/AgentWorkspaceTransportScope.js";
import { quoteShellArguments } from "../Execution/SeneraShellQuoting.js";
import type { AgentHostToolContext } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import type { AgentSelfInvocation } from "./AgentSelfServiceTypes.js";
import type { AgentSelfModelOutput } from "./AgentSelfModelExecutor.js";
import { AgentSelfCliConnectionEnvironment, selfServiceUrl } from "./AgentSelfCliConnection.js";

export interface AgentSelfCliLease {
  readonly environment: NodeJS.ProcessEnv;
  close(): void;
}

type ModelExecutor = (input: AgentSelfInvocation, context: AgentHostToolContext) => Promise<AgentSelfModelOutput>;
export type AgentSelfCliHandler = (input: AgentSelfInvocation, signal?: AbortSignal) => Promise<AgentSelfModelOutput>;

interface CliLauncher {
  readonly directory: string;
  readonly environment: NodeJS.ProcessEnv;
}

/** One credential per Shell resource. Identity and approvals live only in the host. */
export class AgentSelfCliRuntime {
  private readonly handlers = new Map<string, { execute: AgentSelfCliHandler; close(): void }>();
  private launcher: Promise<CliLauncher> | undefined;
  private endpoint: string | undefined;
  private closed = false;

  constructor(private readonly workspaceRoot: string) {}

  bindEndpoint(host: string, port: number, workspaceId?: string): void {
    const url = selfServiceUrl(host, port);
    this.endpoint = workspaceId ? scopeAgentWorkspaceUrl(url, workspaceId) : url;
  }

  resolve(token: string): AgentSelfCliHandler | undefined {
    return this.handlers.get(tokenKey(token))?.execute;
  }

  async open(context: AgentHostToolContext, execute: ModelExecutor): Promise<AgentSelfCliLease> {
    context.signal?.throwIfAborted();
    if (this.closed || !this.endpoint) throw new Error("Senera CLI runtime is not listening.");
    if (!context.sessionId) throw new Error("Senera CLI requires an active session context.");
    const launcher = await (this.launcher ??= createCliLauncher());
    context.signal?.throwIfAborted();
    if (this.closed) throw new Error("Senera CLI runtime is closed.");
    const token = randomBytes(32).toString("base64url");
    const key = tokenKey(token);
    const controller = new AbortController();
    const close = (): void => {
      this.handlers.delete(key);
      context.signal?.removeEventListener("abort", close);
      controller.abort(new Error("The originating Shell resource has ended."));
    };
    this.handlers.set(key, {
      close,
      execute: (input, requestSignal) =>
        execute(input, {
          ...context,
          signal: requestSignal ? AbortSignal.any([controller.signal, requestSignal]) : controller.signal,
        }),
    });
    context.signal?.addEventListener("abort", close, { once: true });
    return {
      environment: {
        ...launcher.environment,
        PATH: [launcher.directory, process.env.PATH].filter(Boolean).join(path.delimiter),
        SENERA_WORKSPACE_ROOT: this.workspaceRoot,
        [AgentSelfCliConnectionEnvironment]: JSON.stringify({ url: this.endpoint, token }),
      },
      close,
    };
  }

  async dispose(): Promise<void> {
    this.closed = true;
    for (const handler of this.handlers.values()) handler.close();
    this.endpoint = undefined;
    if (this.launcher) await rm((await this.launcher).directory, { recursive: true, force: true });
  }
}

function tokenKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Use the running distribution's Node/Electron and CLI, including in development. */
async function createCliLauncher(): Promise<CliLauncher> {
  const extension = path.extname(fileURLToPath(import.meta.url));
  const cli = fileURLToPath(new URL(`../../../Apps/SeneraCli${extension}`, import.meta.url));
  const args = extension === ".ts" ? ["--import", import.meta.resolve("tsx"), cli] : [cli];
  const directory = await mkdtemp(path.join(tmpdir(), "senera-cli-"));
  const environment: NodeJS.ProcessEnv = {};
  try {
    if (process.platform === "win32") {
      // Keep the batch file ASCII: paths travel through Unicode environment values.
      environment.SENERA_CLI_NODE = process.execPath;
      environment.SENERA_CLI_ENTRY = cli;
      const loader = extension === ".ts" ? '--import "%SENERA_CLI_LOADER%" ' : "";
      if (extension === ".ts") environment.SENERA_CLI_LOADER = args[1];
      await writeFile(
        path.join(directory, "senera.cmd"),
        `@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"%SENERA_CLI_NODE%" ${loader}"%SENERA_CLI_ENTRY%" %*\r\n`,
        "utf8",
      );
    } else {
      const launcher = path.join(directory, "senera");
      const command = quoteShellArguments([process.execPath, ...args]);
      await writeFile(launcher, `#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec ${command} "$@"\n`, "utf8");
      await chmod(launcher, 0o700);
    }
    return { directory, environment };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
