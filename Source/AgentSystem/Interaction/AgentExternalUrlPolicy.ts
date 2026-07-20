import net from "node:net";

export interface AgentExternalUrlPolicy {
  readonly allowHttps: boolean;
  readonly allowLoopbackHttp: boolean;
  readonly allowCredentials: boolean;
}

export interface AgentExternalUrl {
  readonly url: string;
  readonly hostname: string;
  readonly origin: string;
  readonly protocol: "http:" | "https:";
}

export const DefaultAgentExternalUrlPolicy = {
  allowHttps: true,
  allowLoopbackHttp: true,
  allowCredentials: false,
} as const satisfies AgentExternalUrlPolicy;

export class AgentExternalUrlPolicyError extends Error {
  constructor(
    message: string,
    readonly input: string,
  ) {
    super(message);
    this.name = "AgentExternalUrlPolicyError";
  }
}

export function resolveAgentExternalUrl(
  input: string,
  policy: AgentExternalUrlPolicy = DefaultAgentExternalUrlPolicy,
): AgentExternalUrl {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new AgentExternalUrlPolicyError("External interaction URL is invalid.", input);
  }
  if (!policy.allowCredentials && (parsed.username || parsed.password)) {
    throw new AgentExternalUrlPolicyError("External interaction URL must not contain embedded credentials.", input);
  }
  const protocolAllowed =
    (parsed.protocol === "https:" && policy.allowHttps) ||
    (parsed.protocol === "http:" && policy.allowLoopbackHttp && isLoopbackHostname(parsed.hostname));
  if (!protocolAllowed) {
    throw new AgentExternalUrlPolicyError(
      "External interaction URL must use HTTPS, except HTTP loopback callbacks.",
      input,
    );
  }
  return {
    url: parsed.href,
    hostname: parsed.hostname,
    origin: parsed.origin,
    protocol: parsed.protocol as AgentExternalUrl["protocol"],
  };
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) return normalized.startsWith("127.");
  return ipVersion === 6 && normalized === "::1";
}
