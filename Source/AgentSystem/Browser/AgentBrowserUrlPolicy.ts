import {
  AgentWebUrlPolicyError,
  assertSafeWebUrl,
  canonicalizeWebUrl,
  type AgentWebAddressResolver,
} from "../Web/AgentWebUrlPolicy.js";

export const AgentBrowserNetworkPermissionId = "network-web-browser" as const;

export interface AgentBrowserTargetAuthorization {
  readonly scope: string;
}

export interface AgentBrowserTargetInspection {
  readonly url: URL;
  readonly scope: string;
  readonly requiresApproval: boolean;
  readonly kind: "public-web" | "restricted-web" | "local-file";
}

export interface AgentBrowserTargetInspectionOptions {
  readonly maxUrlLength: number;
  readonly fullAccess?: boolean;
  readonly resolveHostAddresses?: AgentWebAddressResolver;
}

export async function inspectAgentBrowserTarget(
  value: string,
  options: AgentBrowserTargetInspectionOptions,
): Promise<AgentBrowserTargetInspection> {
  const url = canonicalizeAgentBrowserUrl(value, options.maxUrlLength);
  if (url.protocol === "file:") {
    return {
      url,
      scope: browserTargetScope(url),
      requiresApproval: !options.fullAccess,
      kind: "local-file",
    };
  }

  if (options.fullAccess) {
    return { url, scope: url.origin, requiresApproval: false, kind: "public-web" };
  }

  try {
    await assertSafeWebUrl(
      url,
      {
        maxUrlLength: options.maxUrlLength,
        allowPrivateNetworks: false,
        allowSyntheticProxyAddresses: true,
      },
      options.resolveHostAddresses,
    );
    return { url, scope: url.origin, requiresApproval: false, kind: "public-web" };
  } catch (error) {
    if (!(error instanceof AgentWebUrlPolicyError) || error.code !== "private_network_blocked") throw error;
    return { url, scope: url.origin, requiresApproval: true, kind: "restricted-web" };
  }
}

export function canonicalizeAgentBrowserUrl(value: string, maxUrlLength: number): URL {
  const source = value.trim();
  if (!source) throw new AgentWebUrlPolicyError("invalid_url", "Browser URL must not be empty.");
  if (source.length > maxUrlLength) {
    throw new AgentWebUrlPolicyError("url_too_long", "Browser URL exceeds the configured length limit.", {
      length: source.length,
      maxUrlLength,
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(source);
  } catch (error) {
    throw new AgentWebUrlPolicyError("invalid_url", `Browser URL is invalid: ${source}.`, {}, { cause: error });
  }
  if (parsed.protocol === "file:") {
    if (parsed.username || parsed.password) {
      throw new AgentWebUrlPolicyError("credentials_not_allowed", "File URLs must not contain embedded credentials.");
    }
    return parsed;
  }
  return canonicalizeWebUrl(source, maxUrlLength);
}

export function browserTargetScope(value: string | URL): string {
  const url = value instanceof URL ? new URL(value) : new URL(value);
  if (url.protocol !== "file:") return url.origin;
  url.hash = "";
  return `file:${url.href}`;
}

export function agentBrowserTargetAuthorizationMatches(
  authorization: AgentBrowserTargetAuthorization | undefined,
  value: string | URL,
): boolean {
  return authorization?.scope === browserTargetScope(value);
}
