import type { AgentAuthenticatedSession } from "./AgentAuthenticationProtocol.js";

/** Native WebView origin, shared by the Android build and the server authentication boundary. */
export const AgentMobileOrigin = "https://localhost";
export const AgentDeviceCookieName = "__Host-senera_device";
export const AgentLanDeviceCookieName = "senera_lan_device";
export const AgentDeviceRequestTimeoutSeconds = 10;
export const AgentDeviceResponseMaxBytes = 128 * 1024;

export type AgentDeviceConnectionMethod = "lan" | "domain" | "private-network";

/** HTTP is an explicit private IPv4 LAN transport; internet connections always use HTTPS. */
export function isDeviceLanHost(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [first, second] = parts.map(Number);
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

export function normalizeAgentDeviceServerUrl(value: string): string {
  const url = new URL(value.trim());
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && isDeviceLanHost(url.hostname))) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    ["localhost", "127.0.0.1", "[::1]", "0.0.0.0", "[::]"].includes(url.hostname)
  )
    throw new Error("invalid_device_server_url");
  return url.origin;
}

export const AgentDeviceAuthenticationRoutes = {
  Connection: "/api/auth/devices/connection",
  PrivateNetwork: "/api/auth/devices/private-network",
  Lan: "/api/auth/devices/lan",
  Login: "/api/auth/devices/login",
  Devices: "/api/auth/devices",
  Pairings: "/api/auth/devices/pairings",
  Claim: "/api/auth/devices/pairings/claim",
  Approve: "/api/auth/devices/pairings/approve",
  Exchange: "/api/auth/devices/pairings/exchange",
} as const;

export type AgentDeviceConnectionSnapshot = (
  { readonly authorization: "login" } | { readonly authorization: "authorized"; readonly csrfToken: string }
) & {
  readonly address?: { readonly url: string; readonly source: "saved" | "current" | "private-network" | "lan" };
  readonly method?: AgentDeviceConnectionMethod;
  readonly recommended?: AgentDeviceConnectionMethod;
  readonly canManageNetwork?: boolean;
  readonly lan?: {
    readonly state: "disabled" | "listening" | "failed" | "unavailable";
    readonly interfaces: readonly { readonly name: string; readonly address: string }[];
    readonly port: number;
    readonly url?: string;
    readonly code?: string;
    readonly detail?: string;
  };
  readonly privateNetwork?: {
    readonly state: "missing" | "offline" | "available" | "serving" | "conflict" | "failed";
    readonly url?: string;
    readonly detail?: string;
  };
};

export interface AgentDevicePairingCode {
  readonly version: 1;
  readonly serverUrl: string;
  readonly pairingId: string;
  readonly code: string;
}

export interface AgentDeviceSessionGrant {
  readonly deviceName: string;
  readonly cookie: string;
  readonly session: AgentAuthenticatedSession;
}
