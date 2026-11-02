import { isIP } from "node:net";
import { networkInterfaces } from "node:os";

/** This value is process-local. Never write the scoped credential to disk or tool output. */
export const AgentSelfCliConnectionEnvironment = "SENERA_SELF_CONNECTION";
export const AgentSelfCommandMaximumBytes = 512 * 1_024;
export const AgentSelfHttpRoute = "/senera/self";

export interface AgentSelfCliConnection {
  readonly url: string;
  readonly token: string;
}

export function readAgentSelfCliConnection(environment: NodeJS.ProcessEnv): AgentSelfCliConnection | undefined {
  const value = environment[AgentSelfCliConnectionEnvironment];
  if (value === undefined) return undefined;
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || !("url" in parsed) || !("token" in parsed)) {
    throw new Error("Invalid Senera Shell connection credential.");
  }
  if (typeof parsed.url !== "string" || typeof parsed.token !== "string" || !parsed.token.trim()) {
    throw new Error("Invalid Senera Shell connection credential.");
  }
  const url = new URL(parsed.url);
  if (url.protocol !== "http:" || url.pathname !== AgentSelfHttpRoute || url.username || url.password || url.hash) {
    throw new Error("Senera Shell connection must use the local self-service endpoint.");
  }
  normalizeLocalHost(url.hostname);
  return { url: url.href, token: parsed.token };
}

export function selfServiceUrl(host: string, port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Senera runtime contains an invalid service port.");
  }
  return `http://${normalizeLocalHost(host)}:${port}${AgentSelfHttpRoute}`;
}

function normalizeLocalHost(host: string): string {
  const trimmed = host.trim();
  if (trimmed === "localhost" || trimmed === "0.0.0.0") return "127.0.0.1";
  if (trimmed === "::" || trimmed === "[::]") return "[::1]";
  const unbracketed = trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
  if (isIP(unbracketed) === 4 && unbracketed.startsWith("127.")) return unbracketed;
  if (isIP(unbracketed) === 6 && unbracketed.toLowerCase() === "::1") return "[::1]";
  if (
    isIP(unbracketed) &&
    Object.values(networkInterfaces()).some((addresses) =>
      addresses?.some(({ address }) => address.toLowerCase() === unbracketed.toLowerCase()),
    )
  )
    return isIP(unbracketed) === 6 ? `[${unbracketed}]` : unbracketed;
  throw new Error("Senera self-service connection must use loopback or an address on a local network interface.");
}
