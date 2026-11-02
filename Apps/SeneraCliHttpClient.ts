import { isAgentRuntimeAlive, readAgentRuntimeManifest } from "../Source/AgentSystem/Runtime/AgentRuntimeManifest.js";
import {
  readAgentSelfCliConnection,
  selfServiceUrl,
  type AgentSelfCliConnection,
} from "../Source/AgentSystem/SelfService/AgentSelfCliConnection.js";
export { selfServiceUrl } from "../Source/AgentSystem/SelfService/AgentSelfCliConnection.js";
import { scopeAgentWorkspaceUrl } from "../Source/AgentSystem/WorkspaceResources/AgentWorkspaceTransportScope.js";
import type {
  AgentSelfInvocation,
  AgentSelfCommandOutput,
} from "../Source/AgentSystem/SelfService/AgentSelfServiceTypes.js";

export const AgentSelfHttpDefaultTimeoutMs = 15_000;

/** Structured self-service command sent over HTTP: the strict schema for
 * known commands, or the raw plugin command envelope for plugin-registered
 * commands resolved by the live host. */
export type SeneraCliHttpCommand = AgentSelfInvocation;

export class SeneraSelfServiceOfflineError extends Error {
  constructor(workspaceRoot: string, reason: string) {
    super(
      [
        `Senera 服务未运行（${reason}）。`,
        `工作区: ${workspaceRoot}`,
        "请先启动 Senera（桌面端 / 容器 / 服务模式），再执行该命令。",
      ].join("\n"),
    );
    this.name = "SeneraSelfServiceOfflineError";
  }
}

export interface SeneraSelfHttpClientOptions {
  readonly fetch?: typeof fetch;
  readonly connection?: AgentSelfCliConnection;
  readonly timeoutMs?: number;
}

interface LocalRuntimeRequestTarget {
  readonly url: string;
  readonly authorization: string;
}

/**
 * Executes one `senera` self-service command against the running service.
 * The command runs inside the live host through the same port and executor
 * the session-scoped CLI uses, so config changes are
 * revision-guarded, validated, and broadcast to the frontend.
 */
export async function executeSeneraSelfCommandViaHttp(
  workspaceRoot: string,
  command: SeneraCliHttpCommand,
  options: SeneraSelfHttpClientOptions = {},
): Promise<AgentSelfCommandOutput> {
  const scoped = options.connection ?? readAgentSelfCliConnection(process.env);
  // A scoped connection never reads the administrator manifest, including after expiry.
  const target = scoped
    ? { url: scoped.url, authorization: `Bearer ${scoped.token}` }
    : discoverRuntimeTarget(workspaceRoot);
  const timeoutMs = options.timeoutMs ?? (scoped ? undefined : AgentSelfHttpDefaultTimeoutMs);
  const controller = new AbortController();
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetch ?? fetch)(
      // codeql[js/file-access-to-http]
      target.url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // codeql[js/file-access-to-http]
          authorization: target.authorization,
        },
        body: JSON.stringify(command),
        signal: controller.signal,
      },
    );
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || !("ok" in payload) || typeof payload.ok !== "boolean") {
      throw new Error(`Senera service returned an invalid response (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      const error = "error" in payload ? payload.error : undefined;
      const message =
        error && typeof error === "object" && "message" in error ? String(error.message) : response.statusText;
      throw new Error(`Senera service rejected the command (HTTP ${response.status}): ${message}`);
    }
    if (!("text" in payload) || typeof payload.text !== "string") {
      throw new Error("Senera command response is missing its text result.");
    }
    return payload as AgentSelfCommandOutput;
  } finally {
    clearTimeout(timer);
  }
}

function discoverRuntimeTarget(workspaceRoot: string): LocalRuntimeRequestTarget {
  const manifest = readAgentRuntimeManifest(workspaceRoot);
  if (!manifest) throw new SeneraSelfServiceOfflineError(workspaceRoot, "未发现运行清单 .senera/runtime.json");
  if (!isAgentRuntimeAlive(manifest)) throw new SeneraSelfServiceOfflineError(workspaceRoot, "记录的服务进程已退出");
  if (!manifest.token.trim()) throw new Error("Senera runtime manifest contains an empty service token.");
  const url = selfServiceUrl(manifest.host, manifest.port);
  return {
    url: manifest.workspaceId ? scopeAgentWorkspaceUrl(url, manifest.workspaceId) : url,
    authorization: `Bearer ${manifest.token}`,
  };
}
