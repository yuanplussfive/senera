import { AuthenticationSessionStates } from "./generatedEventCatalog";
import { readMobileBridge } from "../app/mobileBridge";
import { resolveBackendMessage, type BackendMessageData } from "../i18n/backendMessage";
import {
  AgentAuthenticationHttpRoutes,
  AgentAuthenticationMethods,
  type AgentAuthenticationSession,
} from "../../../Source/AgentSystem/Auth/AgentAuthenticationProtocol";

export type ServerAuthentication = AgentAuthenticationSession;
export type ServerAuthenticationAccount = ServerAuthenticatedSession["account"];

export type ServerAuthorizedAuthentication = Exclude<
  ServerAuthentication,
  { readonly state: typeof AuthenticationSessionStates.Anonymous }
>;

export type ServerAuthenticatedSession = Extract<
  ServerAuthentication,
  { readonly state: typeof AuthenticationSessionStates.Authenticated }
>;

export class ServerAuthenticationError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ServerAuthenticationError";
  }
}

export function buildServerApiUrl(httpBaseUrl: string, pathname: string): string {
  const url = new URL(pathname, `${httpBaseUrl.replace(/\/+$/u, "")}/`);
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
}

/** Initializes local owner access and reads remote sessions through the same endpoint. */
export async function initializeServerAuthentication(
  httpBaseUrl: string,
  signal?: AbortSignal,
): Promise<ServerAuthentication> {
  const response = await fetch(buildServerApiUrl(httpBaseUrl, AgentAuthenticationHttpRoutes.Session), {
    method: "POST",
    credentials: "include",
    ...(signal ? { signal } : {}),
    headers: { Accept: "application/json" },
  });
  return readAuthenticationResponse(response);
}

export async function loginServerAuthentication(
  httpBaseUrl: string,
  credentials: { loginName: string; password: string },
): Promise<ServerAuthenticatedSession> {
  const mobile = readMobileBridge();
  if (mobile?.login) return mobile.login(httpBaseUrl, credentials);
  const response = await fetch(buildServerApiUrl(httpBaseUrl, AgentAuthenticationHttpRoutes.Login), {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(credentials),
  });
  const authentication = await readAuthenticationResponse(response);
  if (authentication.state !== AuthenticationSessionStates.Authenticated) {
    throw new ServerAuthenticationError(response.status, "");
  }
  return authentication;
}

export async function logoutServerAuthentication(httpBaseUrl: string, csrfToken: string | undefined): Promise<void> {
  const response = await fetch(buildServerApiUrl(httpBaseUrl, AgentAuthenticationHttpRoutes.Logout), {
    method: "POST",
    credentials: "include",
    headers: {
      ...(csrfToken ? { "X-Senera-Csrf": csrfToken } : {}),
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new ServerAuthenticationError(response.status, "");
  }
  await readMobileBridge()?.logout?.();
}

async function readAuthenticationResponse(response: Response): Promise<ServerAuthentication> {
  const payload = (await response.json().catch(() => undefined)) as
    | {
        ok?: boolean;
        session?: unknown;
        error?: BackendMessageData;
      }
    | undefined;
  if (!response.ok || !payload?.ok || !isServerAuthentication(payload.session)) {
    throw new ServerAuthenticationError(response.status, resolveBackendMessage(payload?.error) ?? "");
  }
  return payload.session;
}

function isServerAuthentication(value: unknown): value is ServerAuthentication {
  if (!value || typeof value !== "object") return false;
  const session = value as Record<string, unknown>;
  if (
    session.state === AuthenticationSessionStates.Disabled ||
    session.state === AuthenticationSessionStates.Anonymous
  ) {
    return true;
  }
  return (
    session.state === AuthenticationSessionStates.Authenticated &&
    Object.values(AgentAuthenticationMethods).some((method) => session.method === method) &&
    isServerAuthenticationAccount(session.account) &&
    typeof session.csrfToken === "string" &&
    typeof session.expiresAt === "string"
  );
}

function isServerAuthenticationAccount(value: unknown): value is ServerAuthenticationAccount {
  if (!value || typeof value !== "object") return false;
  const account = value as Partial<ServerAuthenticationAccount>;
  return (
    typeof account.id === "string" &&
    typeof account.loginName === "string" &&
    typeof account.displayName === "string" &&
    account.role === "owner"
  );
}
