import { isAgentRuntimeAlive, readAgentRuntimeManifest } from "../Source/AgentSystem/Runtime/AgentRuntimeManifest.js";
import type {
  AgentSelfCommand,
  AgentSelfCommandOutput,
} from "../Source/AgentSystem/SelfService/AgentSelfServiceTypes.js";

export const AgentSelfHttpDefaultTimeoutMs = 15_000;

/** Structured self-service command sent over HTTP: the strict schema for
 * known commands, or the raw plugin command envelope for plugin-registered
 * commands resolved by the live host. */
export type SeneraCliHttpCommand =
  AgentSelfCommand | { readonly command: string; readonly action?: string; readonly args: readonly string[] };

export class SeneraSelfServiceOfflineError extends Error {
  constructor(workspaceRoot: string, reason: string) {
    super(
      [
        `Senera 服务未运行（${reason}）。`,
        `工作区: ${workspaceRoot}`,
        "请先启动 Senera（桌面端 / 容器 / 服务模式），再执行该命令；模型侧可直接使用 SeneraCommand 工具。",
      ].join("\n"),
    );
    this.name = "SeneraSelfServiceOfflineError";
  }
}

export interface SeneraSelfHttpClientOptions {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/**
 * Executes one `senera` self-service command against the running service.
 * The command runs inside the live host through the same port and executor
 * the model-facing `SeneraCommand` tool uses, so config changes are
 * revision-guarded, validated, and broadcast to the frontend.
 */
export async function executeSeneraSelfCommandViaHttp(
  workspaceRoot: string,
  command: SeneraCliHttpCommand,
  options: SeneraSelfHttpClientOptions = {},
): Promise<AgentSelfCommandOutput> {
  const manifest = readAgentRuntimeManifest(workspaceRoot);
  if (!manifest) {
    throw new SeneraSelfServiceOfflineError(workspaceRoot, "未发现运行清单 .senera/runtime.json");
  }
  if (!isAgentRuntimeAlive(manifest)) {
    throw new SeneraSelfServiceOfflineError(workspaceRoot, "记录的服务进程已退出");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? AgentSelfHttpDefaultTimeoutMs);
  try {
    const response = await (options.fetch ?? fetch)(selfServiceUrl(manifest.host, manifest.port), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${manifest.token}`,
      },
      body: JSON.stringify(command),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => undefined)) as Partial<AgentSelfCommandOutput> | undefined;
    if (!response.ok || !payload || typeof payload.ok !== "boolean" || typeof payload.text !== "string") {
      throw new Error(
        `Senera 服务返回异常（HTTP ${response.status}）: ${response.statusText}${
          payload?.error ? ` ${payload.error}` : ""
        }`,
      );
    }
    return payload as AgentSelfCommandOutput;
  } finally {
    clearTimeout(timer);
  }
}

export function selfServiceUrl(host: string, port: number): string {
  const normalized = normalizeLoopbackHost(host);
  return `http://${normalized}:${port}/senera/self`;
}

function normalizeLoopbackHost(host: string): string {
  const trimmed = host.trim();
  if (trimmed === "0.0.0.0") return "127.0.0.1";
  if (trimmed === "::" || trimmed === "[::]") return "[::1]";
  if (trimmed.includes(":") && !trimmed.startsWith("[")) return `[${trimmed}]`;
  return trimmed;
}
