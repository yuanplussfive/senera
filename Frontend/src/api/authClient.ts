export interface ServerAuthenticationAccount {
  readonly id: string;
  readonly loginName: string;
  readonly displayName: string;
  readonly role: "owner";
}

export interface ServerAuthentication {
  readonly required: boolean;
  readonly account?: ServerAuthenticationAccount;
  readonly csrfToken?: string;
  readonly expiresAt?: string;
}

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
  if (response.status === 401) {
    return { required: true };
  }
  return readAuthenticationResponse(response);
}

export async function loginServerAuthentication(
  webSocketUrl: string,
  credentials: { loginName: string; password: string },
): Promise<ServerAuthentication> {
  const response = await fetch(buildServerApiUrl(webSocketUrl, "/api/auth/login"), {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(credentials),
  });
  return readAuthenticationResponse(response);
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
        authentication?: ServerAuthentication;
        error?: { message?: string };
      }
    | undefined;
  if (!response.ok || !payload?.ok || !payload.authentication) {
    throw new ServerAuthenticationError(response.status, payload?.error?.message ?? "");
  }
  return payload.authentication;
}
