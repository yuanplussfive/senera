import { AuthenticationSessionStates } from "./generatedEventCatalog";

export interface ServerAuthenticationAccount {
  readonly id: string;
  readonly loginName: string;
  readonly displayName: string;
  readonly role: "owner";
}

export type ServerAuthentication =
  | { readonly state: typeof AuthenticationSessionStates.Disabled }
  | { readonly state: typeof AuthenticationSessionStates.Anonymous }
  | {
      readonly state: typeof AuthenticationSessionStates.Authenticated;
      readonly account: ServerAuthenticationAccount;
      readonly csrfToken: string;
      readonly expiresAt: string;
    };

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

export function buildServerApiUrl(webSocketUrl: string, pathname: string): string {
  const url = new URL(webSocketUrl, window.location.href);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function readServerAuthentication(webSocketUrl: string): Promise<ServerAuthentication> {
  const response = await fetch(buildServerApiUrl(webSocketUrl, "/api/auth/session"), {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  return readAuthenticationResponse(response);
}

export async function loginServerAuthentication(
  webSocketUrl: string,
  credentials: { loginName: string; password: string },
): Promise<ServerAuthenticatedSession> {
  const response = await fetch(buildServerApiUrl(webSocketUrl, "/api/auth/login"), {
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

export async function logoutServerAuthentication(webSocketUrl: string, csrfToken: string | undefined): Promise<void> {
  const response = await fetch(buildServerApiUrl(webSocketUrl, "/api/auth/logout"), {
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
}

async function readAuthenticationResponse(response: Response): Promise<ServerAuthentication> {
  const payload = (await response.json().catch(() => undefined)) as
    | {
        ok?: boolean;
        session?: unknown;
        error?: { message?: string };
      }
    | undefined;
  if (!response.ok || !payload?.ok || !isServerAuthentication(payload.session)) {
    throw new ServerAuthenticationError(response.status, payload?.error?.message ?? "");
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
