// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ServerAuthenticationGate } from "../../../Frontend/src/app/ServerAuthenticationGate.tsx";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("server authentication gate", () => {
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

  test("offers a retry path when the status endpoint is unavailable", async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      React.createElement(ServerAuthenticationGate, {
        state: { status: "failed", error: new Error("network") },
        onLogin: vi.fn(),
        onRetry: retry,
      }),
    );

    await user.click(screen.getByRole("button", { name: frontendMessage("auth.retry") }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
