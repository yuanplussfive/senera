import { createStore } from "zustand/vanilla";
import {
  loginServerAuthentication,
  logoutServerAuthentication,
  initializeServerAuthentication,
  ServerAuthenticationError,
  type ServerAuthentication,
  type ServerAuthorizedAuthentication,
} from "./authClient";
import { AuthenticationSessionStates } from "./generatedEventCatalog";
import { readAgentTransportRetryDelayMs } from "./agentTransportRetry";

export type ServerAuthenticationState =
  | { readonly status: "loading" }
  | { readonly status: "revalidating" }
  | { readonly status: "anonymous" }
  | { readonly status: "authenticated"; readonly authentication: ServerAuthorizedAuthentication }
  | { readonly status: "failed"; readonly error: Error };
export type ServerAuthenticationRevalidationResult =
  "authorized" | "anonymous" | "rejected" | "unreachable" | "superseded";
export interface ServerAuthenticationLifecycle {
  onInitialRequestStarted?: () => void;
  prepareAuthorizedSurface?: () => Promise<void>;
}

/** Session state is independent of the UI framework and protocol connections. */
export class ServerAuthenticationController {
  readonly store = createStore<ServerAuthenticationState>(() => ({ status: "loading" }));
  private operation = 0;
  private started = false;
  private initialRequestStarted = false;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private channel?: BroadcastChannel;
  private validation?: Promise<ServerAuthenticationRevalidationResult>;
  private lifetime = new AbortController();

  constructor(
    readonly httpBaseUrl: string,
    private lifecycle: ServerAuthenticationLifecycle = {},
  ) {}
  configure(lifecycle: ServerAuthenticationLifecycle): void {
    this.lifecycle = lifecycle;
  }
  get signal(): AbortSignal {
    return this.lifetime.signal;
  }

  start = (): void => {
    if (this.started) return;
    this.started = true;
    this.lifetime = new AbortController();
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(`senera-auth:${new URL(this.httpBaseUrl).origin}`);
      this.channel.onmessage = () => {
        void this.revalidate();
      };
    }
    const request = initializeServerAuthentication(this.httpBaseUrl, this.lifetime.signal);
    if (!this.initialRequestStarted) {
      this.initialRequestStarted = true;
      this.lifecycle.onInitialRequestStarted?.();
    }
    void this.read(++this.operation, request);
  };

  stop = (): void => {
    this.started = false;
    this.operation++;
    this.validation = undefined;
    this.lifetime.abort();
    this.cancelRetry();
    this.channel?.close();
    this.channel = undefined;
  };
  private cancelRetry(): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }
  private setState(state: ServerAuthenticationState): void {
    this.store.setState(state, true);
  }
  private async prepare(authentication: ServerAuthentication): Promise<void> {
    if (authentication.state === AuthenticationSessionStates.Anonymous) return;
    try {
      await this.lifecycle.prepareAuthorizedSurface?.();
    } catch {
      /* Optional preloading cannot invalidate the server's authorization. */
    }
  }
  private adopt(authentication: ServerAuthentication): void {
    this.setState(
      authentication.state === AuthenticationSessionStates.Anonymous
        ? { status: "anonymous" }
        : { status: "authenticated", authentication },
    );
  }
  private async read(
    operation: number,
    request = initializeServerAuthentication(this.httpBaseUrl, this.lifetime.signal),
    attempt = 0,
  ): Promise<void> {
    try {
      const authentication = await request;
      if (operation !== this.operation) return;
      this.cancelRetry();
      await this.prepare(authentication);
      if (operation === this.operation) this.adopt(authentication);
    } catch (error) {
      if (operation !== this.operation) return;
      const transient =
        !(error instanceof ServerAuthenticationError) ||
        error.status === 408 ||
        error.status === 429 ||
        error.status >= 500;
      if (transient) {
        this.setState({ status: "revalidating" });
        this.retryTimer = setTimeout(() => {
          this.retryTimer = undefined;
          void this.read(
            operation,
            initializeServerAuthentication(this.httpBaseUrl, this.lifetime.signal),
            attempt + 1,
          );
        }, readAgentTransportRetryDelayMs(attempt));
      } else this.setState({ status: "failed", error: error instanceof Error ? error : new Error(String(error)) });
    }
  }
  refresh = async (): Promise<void> => {
    const operation = ++this.operation;
    this.cancelRetry();
    if (this.store.getState().status !== "loading") this.setState({ status: "revalidating" });
    await this.read(operation);
  };
  login = async (credentials: { loginName: string; password: string }): Promise<void> => {
    const operation = ++this.operation;
    this.cancelRetry();
    const authentication = await loginServerAuthentication(this.httpBaseUrl, credentials);
    if (operation !== this.operation) return;
    await this.prepare(authentication);
    if (operation === this.operation) {
      this.adopt(authentication);
      this.channel?.postMessage("changed");
    }
  };
  logout = async (): Promise<void> => {
    const operation = ++this.operation;
    this.cancelRetry();
    const state = this.store.getState();
    const csrf = state.status === "authenticated" ? readAuthenticationCsrfToken(state.authentication) : undefined;
    await logoutServerAuthentication(this.httpBaseUrl, csrf);
    if (operation === this.operation) {
      this.setState({ status: "anonymous" });
      this.channel?.postMessage("changed");
    }
  };
  revalidate = (): Promise<ServerAuthenticationRevalidationResult> => {
    if (this.validation) return this.validation;
    const operation = ++this.operation;
    this.cancelRetry();
    const validation = this.validate(operation).finally(() => {
      if (this.validation === validation) this.validation = undefined;
    });
    this.validation = validation;
    return validation;
  };
  private async validate(operation: number): Promise<ServerAuthenticationRevalidationResult> {
    const state = this.store.getState();
    if (state.status === "loading" || state.status === "revalidating") {
      // A resume event during startup follows the startup retry policy too.
      await this.read(operation);
      if (operation !== this.operation) return "superseded";
      const current = this.store.getState();
      return current.status === "authenticated"
        ? "authorized"
        : current.status === "anonymous"
          ? "anonymous"
          : current.status === "failed"
            ? "rejected"
            : "unreachable";
    }
    try {
      const authentication = await initializeServerAuthentication(this.httpBaseUrl, this.lifetime.signal);
      if (operation !== this.operation) return "superseded";
      this.adopt(authentication);
      return authentication.state === AuthenticationSessionStates.Anonymous ? "anonymous" : "authorized";
    } catch (error) {
      if (operation !== this.operation) return "superseded";
      if (error instanceof ServerAuthenticationError && (error.status === 401 || error.status === 403)) {
        this.setState({ status: "failed", error });
        return "rejected";
      }
      return "unreachable";
    }
  }
  /** File selection reads the established session without another authentication request. */
  mutationHeaders = (): Record<string, string> => {
    const state = this.store.getState();
    if (state.status === "failed") throw state.error;
    if (state.status !== "authenticated")
      throw new ServerAuthenticationError(401, "Senera authentication is required.");
    return authenticationMutationHeaders(state.authentication);
  };
}

export function readAuthenticationCsrfToken(authentication: ServerAuthorizedAuthentication): string | undefined {
  return authentication.state === AuthenticationSessionStates.Authenticated ? authentication.csrfToken : undefined;
}
export function authenticationMutationHeaders(authentication: ServerAuthorizedAuthentication): Record<string, string> {
  const token = readAuthenticationCsrfToken(authentication);
  return token ? { "X-Senera-Csrf": token } : {};
}
