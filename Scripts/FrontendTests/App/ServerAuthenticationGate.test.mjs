// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  ServerAuthenticationBoundary,
  ServerAuthenticationGate,
} from "../../../Frontend/src/app/ServerAuthenticationGate.tsx";
import { ServerAuthenticationError } from "../../../Frontend/src/api/authClient.ts";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("server authentication gate", () => {
  test("does not mount authenticated application content before the session is resolved", () => {
    const child = vi.fn(() => React.createElement("div", null, "Protected workspace"));
    const props = {
      onLogin: vi.fn(),
      onRetry: vi.fn(),
      children: child,
    };
    const { rerender } = render(
      React.createElement(ServerAuthenticationBoundary, {
        ...props,
        state: { status: "loading" },
      }),
    );

    expect(child).not.toHaveBeenCalled();
    expect(screen.queryByText("Protected workspace")).not.toBeInTheDocument();

    rerender(
      React.createElement(ServerAuthenticationBoundary, {
        ...props,
        state: {
          status: "authenticated",
          authentication: {
            state: "authenticated",
            account: { id: "owner", loginName: "owner", displayName: "Owner", role: "owner" },
            csrfToken: "csrf",
            expiresAt: "2026-07-25T00:00:00.000Z",
          },
        },
      }),
    );

    expect(child).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Protected workspace")).toBeVisible();
  });

  test("submits the supplied login name and password", async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      React.createElement(ServerAuthenticationGate, {
        state: { status: "anonymous" },
        onLogin: login,
        onRetry: vi.fn(),
      }),
    );

    await user.type(screen.getByLabelText(frontendMessage("auth.loginName")), "owner");
    await user.type(screen.getByLabelText(frontendMessage("auth.password")), "a long administrator password");
    await user.click(screen.getByRole("button", { name: frontendMessage("auth.signIn") }));

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith({ loginName: "owner", password: "a long administrator password" });
    });
  });

  test("does not disclose the concrete server authentication failure", async () => {
    const login = vi.fn().mockRejectedValue(new Error("credential detail"));
    const user = userEvent.setup();
    render(
      React.createElement(ServerAuthenticationGate, {
        state: { status: "anonymous" },
        onLogin: login,
        onRetry: vi.fn(),
      }),
    );

    await user.type(screen.getByLabelText(frontendMessage("auth.loginName")), "owner");
    await user.type(screen.getByLabelText(frontendMessage("auth.password")), "wrong password value");
    await user.click(screen.getByRole("button", { name: frontendMessage("auth.signIn") }));

    expect(await screen.findByText(frontendMessage("auth.loginFailed"))).toBeVisible();
    expect(screen.queryByText("credential detail")).not.toBeInTheDocument();
  });

  test("does not invent a connection message when no server detail is available", () => {
    render(
      React.createElement(ServerAuthenticationGate, {
        state: { status: "failed", error: new Error("Failed to fetch") },
        onLogin: vi.fn(),
        onRetry: vi.fn(),
      }),
    );

    expect(screen.queryByText(frontendMessage("auth.connectionFailed"))).not.toBeInTheDocument();
  });

  test("shows the server-provided failure detail and offers retry", async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      React.createElement(ServerAuthenticationGate, {
        state: { status: "failed", error: new ServerAuthenticationError(503, "Backend unavailable") },
        onLogin: vi.fn(),
        onRetry: retry,
      }),
    );

    expect(screen.getByText("Backend unavailable")).toBeVisible();
    await user.click(screen.getByRole("button", { name: frontendMessage("auth.retry") }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
