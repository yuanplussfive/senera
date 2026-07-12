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
}));

import { useServerAuthentication } from "../../../Frontend/src/app/useServerAuthentication.ts";

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
    .mockResolvedValueOnce({ required: true });
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
  authenticationApi.read.mockResolvedValue({ required: true });
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

function AuthenticationHarness({ handleRef }) {
  const handle = useServerAuthentication(WebSocketUrl);
  useEffect(() => {
    handleRef.current = handle;
  }, [handle, handleRef]);
  return null;
}

function authenticatedSession(overrides = {}) {
  return {
    required: true,
    account: {
      id: "account-1",
      loginName: "owner",
      displayName: "Owner",
      role: "owner",
    },
    csrfToken: "csrf-token",
    expiresAt: "2026-07-15T00:00:00.000Z",
    ...overrides,
  };
}
