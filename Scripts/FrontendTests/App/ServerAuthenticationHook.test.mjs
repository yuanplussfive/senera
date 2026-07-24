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

const WebSocketUrl = "wss://agent.example.test/socket";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
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

  expect(authenticationApi.logout).toHaveBeenCalledWith(WebSocketUrl, authentication.csrfToken);
  expect(handleRef.current.state).toEqual({ status: "anonymous" });
});

test("moves from a failed status through retry into an anonymous sign-in state", async () => {
  authenticationApi.read
    .mockRejectedValueOnce(new Error("network unavailable"))
    .mockResolvedValueOnce({ state: "anonymous" });
  const handleRef = { current: null };

  render(React.createElement(AuthenticationHarness, { handleRef }));

  await waitFor(() => {
    expect(handleRef.current.state).toMatchObject({ status: "failed", error: new Error("network unavailable") });
  });

  await act(async () => {
    await handleRef.current.refresh();
  });

  expect(handleRef.current.state).toEqual({ status: "anonymous" });
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

  expect(authenticationApi.login).toHaveBeenCalledWith(WebSocketUrl, credentials);
  expect(handleRef.current.state).toEqual({ status: "authenticated", authentication });
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

function AuthenticationHarness({ handleRef }) {
  const handle = useServerAuthentication(WebSocketUrl);
  useEffect(() => {
    handleRef.current = handle;
  }, [handle, handleRef]);
  return null;
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
