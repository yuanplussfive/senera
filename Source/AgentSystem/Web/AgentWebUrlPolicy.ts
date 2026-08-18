import { lookup } from "node:dns/promises";
import net from "node:net";
import { AgentBaseError } from "../Core/AgentBaseError.js";

export interface AgentWebUrlPolicyOptions {
  readonly maxUrlLength: number;
  readonly allowPrivateNetworks: boolean;
  /** Permit a hostname resolved exclusively to the 198.18.0.0/15 Fake-IP range used by local proxies. */
  readonly allowSyntheticProxyAddresses?: boolean;
}

export type AgentWebAddressResolver = (hostname: string) => Promise<readonly string[]>;

export class AgentWebUrlPolicyError extends AgentBaseError {
  constructor(
    readonly code:
      | "invalid_url"
      | "unsupported_scheme"
      | "credentials_not_allowed"
      | "url_too_long"
      | "private_network_blocked"
      | "dns_resolution_failed",
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export function canonicalizeWebUrl(value: string, maxUrlLength: number): URL {
  const source = value.trim();
  if (!source) {
    throw new AgentWebUrlPolicyError("invalid_url", "Web URL must not be empty.");
  }
  if (source.length > maxUrlLength) {
    throw new AgentWebUrlPolicyError("url_too_long", "Web URL exceeds the configured length limit.", {
      length: source.length,
      maxUrlLength,
    });
  }

  let url: URL;
  try {
    url = new URL(source);
  } catch (error) {
    throw new AgentWebUrlPolicyError("invalid_url", `Web URL is invalid: ${source}.`, {}, { cause: error });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AgentWebUrlPolicyError("unsupported_scheme", `Web URL scheme is not allowed: ${url.protocol}.`, {
      scheme: url.protocol,
    });
  }
  if (url.username || url.password) {
    throw new AgentWebUrlPolicyError("credentials_not_allowed", "Web URLs must not contain embedded credentials.");
  }
  url.hash = "";
  return url;
}

export async function assertSafeWebUrl(
  value: string | URL,
  options: AgentWebUrlPolicyOptions,
  resolveAddresses: AgentWebAddressResolver = defaultResolveAddresses,
): Promise<URL> {
  const url = canonicalizeWebUrl(String(value), options.maxUrlLength);
  if (options.allowPrivateNetworks) return url;

  const isLiteralAddress = net.isIP(url.hostname) !== 0;
  if (isBlockedAddress(url.hostname)) {
    throw privateNetworkError(url.hostname);
  }

  let addresses: readonly string[];
  try {
    addresses = await resolveAddresses(url.hostname);
  } catch (error) {
    throw new AgentWebUrlPolicyError(
      "dns_resolution_failed",
      `Unable to resolve the web host: ${url.hostname}.`,
      { hostname: url.hostname },
      { cause: error },
    );
  }
  const syntheticProxyMapping =
    options.allowSyntheticProxyAddresses === true &&
    !isLiteralAddress &&
    addresses.length > 0 &&
    addresses.every(isSyntheticProxyAddress);
  if ((addresses.length === 0 || addresses.some(isBlockedAddress)) && !syntheticProxyMapping) {
    throw privateNetworkError(url.hostname, addresses);
  }
  return url;
}

function isSyntheticProxyAddress(value: string): boolean {
  const normalized = value.trim();
  const parts = normalized.split(".").map(Number);
  return net.isIP(normalized) === 4 && parts.length === 4 && parts[0] === 198 && (parts[1] === 18 || parts[1] === 19);
}

const defaultResolveAddresses: AgentWebAddressResolver = async (hostname) => {
  if (net.isIP(hostname)) return [hostname];
  const entries = await lookup(hostname, { all: true, verbatim: true });
  return entries.map((entry) => entry.address);
};

function privateNetworkError(hostname: string, addresses: readonly string[] = []): AgentWebUrlPolicyError {
  return new AgentWebUrlPolicyError(
    "private_network_blocked",
    `Web host resolves to a private or reserved network: ${hostname}.`,
    {
      hostname,
      addresses,
    },
  );
}

function isBlockedAddress(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/%.*$/u, "");
  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) return isBlockedIpv4(normalized);
  if (ipVersion === 6) return isBlockedIpv6(normalized);
  return normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local");
}

function isBlockedIpv4(value: string): boolean {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first, second] = parts;
  const number = parts.reduce((total, part) => total * 256 + part, 0);
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19 || second === 51)) ||
    (first === 203 && second === 0 && parts[2] === 113) ||
    number >= 0xe0000000
  );
}

function isBlockedIpv6(value: string): boolean {
  const normalized = value.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("ff")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true;
  }
  if (normalized.startsWith("2001:db8:")) return true;
  const mappedIpv4 = readMappedIpv4(normalized);
  return mappedIpv4 ? isBlockedIpv4(mappedIpv4) : false;
}

function readMappedIpv4(value: string): string | undefined {
  const marker = value.lastIndexOf(":ffff:");
  if (marker < 0) return undefined;
  const tail = value.slice(marker + 6);
  if (tail.includes(".")) return net.isIP(tail) === 4 ? tail : undefined;
  const groups = tail.split(":");
  if (groups.length !== 2 || groups.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))) return undefined;
  const first = Number.parseInt(groups[0]!, 16);
  const second = Number.parseInt(groups[1]!, 16);
  return `${first >> 8}.${first & 255}.${second >> 8}.${second & 255}`;
}
