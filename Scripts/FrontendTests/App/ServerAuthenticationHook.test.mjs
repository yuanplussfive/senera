// @vitest-environment jsdom

import React, { useEffect } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const authenticationApi = vi.hoisted(() => ({
  login: vi.fn(),
  logout: vi.fn(),
  read: vi.fn(),
}));

vi.mock("../../../Frontend/src/api/authClient.ts", () => ({
  loginServerAuthentication: authenticationApi.login,
  logoutServerAuthentication: authenticationApi.logout,
  readServerAuthentication: authenticationApi.read,
  ServerAuthenticationError: class ServerAuthenticationError extends Error {
    constructor(status, message) {
      super(message);
      this.name = "ServerAuthenticationError";
      this.status = status;
    }
  },
}));

import { useServerAuthentication } from "../../../Frontend/src/app/useServerAuthentication.ts";
import { ServerAuthenticationError } from "../../../Frontend/src/api/authClient.ts";

const HttpBaseUrl = "https://agent.example.test";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test("restores an existing session and sends its CSRF token when signing out", async () => {
  const authentication = authenticatedSession();
  authenticationApi.read.mockResolvedValue(authentication);
  authenticationApi.logout.mockResolvedValue(undefined);
  const handleRef = { current: null };

  render(React.createElement(AuthenticationHarness, { handleRef }));

  await waitFor(() => {
    expect(handleRef.current.state).toEqual({ status: "authenticated", authentication });
  });

  await act(async () => {
    await handleRef.current.logout();
  });

  expect(authenticationApi.logout).toHaveBeenCalledWith(HttpBaseUrl, authentication.csrfToken);
  expect(handleRef.current.state).toEqual({ status: "anonymous" });
});

test("moves from a failed status through revalidation into an anonymous sign-in state", async () => {
  const retryRequest = deferredPromise();
  authenticationApi.read
    .mockRejectedValueOnce(new ServerAuthenticationError(403, "access denied"))
    .mockImplementationOnce(() => retryRequest.promise);
  const handleRef = { current: null };

  render(React.createElement(AuthenticationHarness, { handleRef }));

  await waitFor(() => {
    expect(handleRef.current.state).toMatchObject({ status: "failed", error: { status: 403 } });
  });

  let refresh;
  act(() => {
    refresh = handleRef.current.refresh();
  });
  expect(handleRef.current.state).toEqual({ status: "revalidating" });

  retryRequest.resolve({ state: "anonymous" });
  await act(async () => refresh);

  expect(handleRef.current.state).toEqual({ status: "anonymous" });
});

test("keeps the startup surface loading while a transient server failure recovers", async () => {
  vi.useFakeTimers();
  authenticationApi.read.mockRejectedValueOnce(new Error("server is still starting")).mockResolvedValueOnce({
    state: "anonymous",
  });
  const handleRef = { current: null };

  render(React.createElement(AuthenticationHarness, { handleRef }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });

  expect(authenticationApi.read).toHaveBeenCalledTimes(2);
  expect(handleRef.current.state).toEqual({ status: "anonymous" });
});

test("does not retry an explicit authentication rejection during startup", async () => {
  vi.useFakeTimers();
  authenticationApi.read.mockRejectedValue(new ServerAuthenticationError(403, "Origin denied"));
  const handleRef = { current: null };

  render(React.createElement(AuthenticationHarness, { handleRef }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });

  expect(authenticationApi.read).toHaveBeenCalledTimes(1);
  expect(handleRef.current.state).toMatchObject({ status: "failed", error: { status: 403 } });
});

test("uses the authentication API result as the authoritative post-login session", async () => {
  authenticationApi.read.mockResolvedValue({ state: "anonymous" });
  const authentication = authenticatedSession({ csrfToken: "fresh-csrf", loginName: "operator" });
  authenticationApi.login.mockResolvedValue(authentication);
  const handleRef = { current: null };
  const credentials = { loginName: "operator", password: "a long administrator password" };

  render(React.createElement(AuthenticationHarness, { handleRef }));

  await waitFor(() => {
    expect(handleRef.current.state).toEqual({ status: "anonymous" });
  });
  await act(async () => {
    await handleRef.current.login(credentials);
  });

  expect(authenticationApi.login).toHaveBeenCalledWith(HttpBaseUrl, credentials);
  expect(handleRef.current.state).toEqual({ status: "authenticated", authentication });
});

test("starts desktop preloading after creating the initial authentication request", async () => {
  const callOrder = [];
  authenticationApi.read.mockImplementation(() => {
    callOrder.push("read");
    return Promise.resolve({ state: "anonymous" });
  });
  const onInitialRequestStarted = vi.fn(() => callOrder.push("preload"));
  const handleRef = { current: null };

  render(React.createElement(AuthenticationHarness, { handleRef, lifecycle: { onInitialRequestStarted } }));
  await waitFor(() => expect(handleRef.current.state).toEqual({ status: "anonymous" }));

  expect(callOrder).toEqual(["read", "preload"]);
  expect(onInitialRequestStarted).toHaveBeenCalledTimes(1);
});

test("keeps the sign-in state visible until the authenticated surface is ready", async () => {
  authenticationApi.read.mockResolvedValue({ state: "anonymous" });
  authenticationApi.login.mockResolvedValue(authenticatedSession());
  const preparation = deferredPromise();
  const prepareAuthorizedSurface = vi.fn(() => preparation.promise);
  const handleRef = { current: null };

  render(React.createElement(AuthenticationHarness, { handleRef, lifecycle: { prepareAuthorizedSurface } }));
  await waitFor(() => expect(handleRef.current.state).toEqual({ status: "anonymous" }));

  let login;
  act(() => {
    login = handleRef.current.login({ loginName: "owner", password: "correct horse battery staple" });
  });
  await waitFor(() => expect(prepareAuthorizedSurface).toHaveBeenCalledTimes(1));
  expect(handleRef.current.state).toEqual({ status: "anonymous" });

  preparation.resolve();
  await act(async () => login);
  expect(handleRef.current.state.status).toBe("authenticated");
});

test("does not turn a valid session into an authentication failure when preloading fails", async () => {
  const authentication = authenticatedSession();
  authenticationApi.read.mockResolvedValue(authentication);
  const prepareAuthorizedSurface = vi.fn().mockRejectedValue(new Error("chunk unavailable"));
  const handleRef = { current: null };

  render(React.createElement(AuthenticationHarness, { handleRef, lifecycle: { prepareAuthorizedSurface } }));

  await waitFor(() => expect(handleRef.current.state).toEqual({ status: "authenticated", authentication }));
  expect(prepareAuthorizedSurface).toHaveBeenCalledTimes(1);
});

test("prepares the authenticated application immediately when server authentication is disabled", async () => {
  authenticationApi.read.mockResolvedValue({ state: "disabled" });
  const prepareAuthorizedSurface = vi.fn().mockResolvedValue(undefined);
  const handleRef = { current: null };

  render(React.createElement(AuthenticationHarness, { handleRef, lifecycle: { prepareAuthorizedSurface } }));

  await waitFor(() =>
    expect(handleRef.current.state).toEqual({ status: "authenticated", authentication: { state: "disabled" } }),
  );
  expect(prepareAuthorizedSurface).toHaveBeenCalledTimes(1);
});

test("moves an active application back to sign-in when reconnect validation finds an anonymous session", async () => {
  authenticationApi.read.mockResolvedValueOnce(authenticatedSession()).mockResolvedValueOnce({ state: "anonymous" });
  const handleRef = { current: null };
  render(React.createElement(AuthenticationHarness, { handleRef }));
  await waitFor(() => expect(handleRef.current.state.status).toBe("authenticated"));

  await act(async () => {
    await expect(handleRef.current.revalidate()).resolves.toBe("anonymous");
  });

  expect(handleRef.current.state).toEqual({ status: "anonymous" });
});

test("preserves an active session while reconnect validation cannot reach the server", async () => {
  const authentication = authenticatedSession();
  authenticationApi.read.mockResolvedValueOnce(authentication).mockRejectedValueOnce(new Error("offline"));
  const handleRef = { current: null };
  render(React.createElement(AuthenticationHarness, { handleRef }));
  await waitFor(() => expect(handleRef.current.state.status).toBe("authenticated"));

  await act(async () => {
    await expect(handleRef.current.revalidate()).resolves.toBe("unreachable");
  });

  expect(handleRef.current.state).toEqual({ status: "authenticated", authentication });
});

test("stops reconnect validation when the server explicitly rejects access", async () => {
  authenticationApi.read
    .mockResolvedValueOnce(authenticatedSession())
    .mockRejectedValueOnce(new ServerAuthenticationError(403, "Origin denied"));
  const handleRef = { current: null };
  render(React.createElement(AuthenticationHarness, { handleRef }));
  await waitFor(() => expect(handleRef.current.state.status).toBe("authenticated"));

  await act(async () => {
    await expect(handleRef.current.revalidate()).resolves.toBe("rejected");
  });

  expect(handleRef.current.state).toMatchObject({ status: "failed", error: { status: 403 } });
});

function AuthenticationHarness({ handleRef, lifecycle }) {
  const handle = useServerAuthentication(HttpBaseUrl, lifecycle);
  useEffect(() => {
    handleRef.current = handle;
  }, [handle, handleRef]);
  return null;
}

function deferredPromise() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function authenticatedSession(overrides = {}) {
  return {
    account: {
      id: "account-1",
      loginName: "owner",
      displayName: "Owner",
      role: "owner",
    },
    csrfToken: "csrf-token",
    expiresAt: "2026-07-15T00:00:00.000Z",
    state: "authenticated",
    ...overrides,
  };
}
