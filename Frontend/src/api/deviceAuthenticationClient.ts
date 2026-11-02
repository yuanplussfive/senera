import {
  AgentDeviceAuthenticationRoutes,
  normalizeAgentDeviceServerUrl,
} from "../../../Source/AgentSystem/Auth/AgentDeviceAuthenticationContract";
import type {
  AgentDevicePairingCode,
  AgentDeviceSessionGrant,
  AgentDeviceConnectionSnapshot,
} from "../../../Source/AgentSystem/Auth/AgentDeviceAuthenticationContract";
import { frontendMessage } from "../i18n/frontendMessageCatalog";

export { AgentDeviceAuthenticationRoutes };
export type { AgentDevicePairingCode, AgentDeviceSessionGrant, AgentDeviceConnectionSnapshot };
export type { AgentDeviceConnectionMethod } from "../../../Source/AgentSystem/Auth/AgentDeviceAuthenticationContract";

export interface DeviceRequestOptions {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  csrfToken?: string;
  signal?: AbortSignal;
}
type DeviceTransport = (url: string, options: DeviceRequestOptions) => Promise<{ status: number; body: string }>;
let nativeTransport: DeviceTransport | undefined;
/** Installed only by the native entrypoint; browser and desktop keep the normal fetch transport. */
export function setDeviceAuthenticationTransport(transport: DeviceTransport): void {
  nativeTransport = transport;
}

export function deviceConnectionFailure(error: unknown): string {
  const code = error instanceof Error && "code" in error ? String(error.code) : undefined;
  const keys = {
    dns_failed: "mobile.errorDns",
    connection_refused: "mobile.errorRefused",
    connection_timeout: "mobile.errorTimeout",
    network_unreachable: "mobile.errorNetwork",
    tls_failed: "mobile.errorTls",
    unexpected_redirect: "mobile.errorRedirect",
    invalid_response: "mobile.errorResponse",
    response_too_large: "mobile.errorResponse",
    request_cancelled: "mobile.cancel",
    network_failed: "mobile.requestFailed",
  } as const;
  return code && code in keys
    ? frontendMessage(keys[code as keyof typeof keys])
    : error instanceof Error
      ? error.message
      : frontendMessage("mobile.requestFailed");
}

export interface ConnectedDevice {
  id: string;
  name: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export interface PendingDevice {
  pairingId: string;
  deviceName: string;
  expiresAt: string;
}

export class DeviceAuthenticationError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(
      frontendMessage(
        code === "forbidden_origin"
          ? "mobile.errorOrigin"
          : code === "csrf_required"
            ? "mobile.errorCsrf"
            : code === "rate_limited" || status === 429
              ? "mobile.errorRate"
              : code === "invalid_request"
                ? "mobile.errorRequest"
                : code === "lan_interface_unavailable"
                  ? "mobile.lanInterfaceLost"
                  : code === "password_login_unavailable"
                    ? "mobile.passwordUnavailable"
                    : code === "account_login_required"
                      ? "mobile.accountRequired"
                      : code === "pairing_unavailable"
                        ? "mobile.pairingExpired"
                        : code === "authentication_required"
                          ? "auth.loginFailed"
                          : "mobile.requestFailed",
      ),
    );
    this.name = "DeviceAuthenticationError";
  }
}

export async function deviceAuthenticationRequest<T>(
  serverUrl: string,
  route: string,
  options: DeviceRequestOptions = {},
): Promise<T> {
  options.signal?.throwIfAborted();
  let status: number;
  let body: string;
  if (nativeTransport) {
    const result = await nativeTransport(new URL(route, serverUrl).toString(), options);
    status = result.status;
    body = result.body;
  } else {
    const response = await fetch(new URL(route, serverUrl).toString(), {
      method: options.method ?? "GET",
      credentials: "include",
      signal: options.signal,
      headers: {
        Accept: "application/json",
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(options.csrfToken ? { "X-Senera-Csrf": options.csrfToken } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    status = response.status;
    body = await response.text();
  }
  options.signal?.throwIfAborted();
  let payload: { ok?: boolean; error?: { code?: string } };
  try {
    payload = JSON.parse(body);
  } catch {
    throw Object.assign(new Error(frontendMessage("mobile.errorResponse")), { code: "invalid_response" });
  }
  if (typeof payload !== "object" || payload === null)
    throw Object.assign(new Error(frontendMessage("mobile.errorResponse")), { code: "invalid_response" });
  if (status < 200 || status >= 300 || payload.ok !== true)
    throw new DeviceAuthenticationError(payload.error?.code ?? "request_failed", status);
  return payload as T;
}

export function normalizeMobileServerUrl(value: string): string {
  try {
    return normalizeAgentDeviceServerUrl(value);
  } catch {
    throw new Error(frontendMessage("mobile.httpsRequired"));
  }
}

export function parseDevicePairingCode(value: string): AgentDevicePairingCode {
  const code: unknown = JSON.parse(value);
  if (typeof code !== "object" || code === null) throw new Error(frontendMessage("mobile.invalidCode"));
  const data = code as Record<string, unknown>;
  const validSecret = (secret: unknown): secret is string =>
    typeof secret === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(secret);
  if (
    data.version !== 1 ||
    typeof data.serverUrl !== "string" ||
    !validSecret(data.pairingId) ||
    !validSecret(data.code)
  )
    throw new Error(frontendMessage("mobile.invalidCode"));
  return {
    version: 1,
    serverUrl: normalizeMobileServerUrl(data.serverUrl),
    pairingId: data.pairingId,
    code: data.code,
  };
}
