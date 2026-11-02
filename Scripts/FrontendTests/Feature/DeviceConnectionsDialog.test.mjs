// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DeviceConnectionsDialog } from "../../../Frontend/src/features/session/DeviceConnectionsDialog.tsx";
import { DeviceConnectionPanel } from "../../../Frontend/src/features/session/DeviceConnectionPanel.tsx";
import { ServerAuthenticationContext } from "../../../Frontend/src/app/useServerAuthentication.ts";
import { AgentDeviceAuthenticationRoutes as Routes } from "../../../Frontend/src/api/deviceAuthenticationClient.ts";

vi.mock("qrcode", () => ({ toCanvas: vi.fn().mockResolvedValue(undefined) }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const props = () => ({
  busy: false,
  error: "",
  devices: [],
  pending: [],
  expired: false,
  onRefresh: vi.fn(),
  onLogin: vi.fn(),
  onSaveAddress: vi.fn(),
  onEnablePrivateNetwork: vi.fn(),
  onDecide: vi.fn(),
  onRevoke: vi.fn(),
  onSelectMethod: vi.fn(),
  onConfigureLan: vi.fn(),
});
const success = (value) =>
  new Response(JSON.stringify({ ok: true, ...value }), { headers: { "Content-Type": "application/json" } });
const authentication = {
  state: { status: "anonymous" },
  login: vi.fn(),
  logout: vi.fn(),
  refresh: vi.fn(),
  revalidate: vi.fn().mockResolvedValue("anonymous"),
};

function renderDialog(element) {
  return render(React.createElement(ServerAuthenticationContext.Provider, { value: authentication }, element));
}

describe("computer to phone onboarding", () => {
  test("automatically authorizes a local computer without polling owner-only routes before authorization", async () => {
    const calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const route = new URL(url).pathname;
        calls.push(route);
        if (route === Routes.Connection)
          return success({
            authorization: "authorized",
            csrfToken: "local-csrf",
            privateNetwork: { state: "missing" },
          });
        if (route === Routes.Devices) return success({ devices: [] });
        if (route === Routes.Pairings) return success({ pending: [] });
        throw new Error(`Unexpected request: ${route}`);
      }),
    );
    renderDialog(
      React.createElement(DeviceConnectionsDialog, {
        open: true,
        onOpenChange: vi.fn(),
        httpBaseUrl: "http://127.0.0.1:8787",
      }),
    );
    await screen.findByRole("radio", { name: "局域网" });
    await waitFor(() => expect(calls).toContain(Routes.Devices));
    expect(calls.indexOf(Routes.Connection)).toBeLessThan(calls.indexOf(Routes.Devices));
    expect(screen.queryByText("当前登录已过期。请登录后确认手机连接。")).toBeNull();
    expect(screen.queryByLabelText("电脑服务地址")).toBeNull();
  });

  test("uses the detected public address to create a QR code immediately without an address form", async () => {
    const fetch = vi.fn(async (url, options) => {
      const route = new URL(url).pathname;
      if (route === Routes.Connection)
        return success({
          authorization: "authorized",
          csrfToken: "csrf",
          address: { url: "https://computer.test", source: "current" },
        });
      if (route === Routes.Pairings && options.method === "POST")
        return success({
          pairingId: "p".repeat(32),
          code: "s".repeat(43),
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        });
      return success(route === Routes.Devices ? { devices: [] } : { pending: [] });
    });
    vi.stubGlobal("fetch", fetch);
    renderDialog(
      React.createElement(DeviceConnectionsDialog, {
        open: true,
        onOpenChange: vi.fn(),
        httpBaseUrl: "https://computer.test",
      }),
    );
    await screen.findByLabelText("Senera 手机登录二维码");
    const { toCanvas } = await import("qrcode");
    await waitFor(() => expect(toCanvas).toHaveBeenCalled());
    expect(JSON.parse(toCanvas.mock.calls.at(-1)[1]).serverUrl).toBe("https://computer.test");
  });

  test("an expired public session hands off to the sign-in surface without repeated device requests", async () => {
    const fetch = vi.fn().mockImplementation(async () => success({ authorization: "login" }));
    vi.stubGlobal("fetch", fetch);
    renderDialog(
      React.createElement(DeviceConnectionsDialog, {
        open: true,
        onOpenChange: vi.fn(),
        httpBaseUrl: "https://computer.test",
      }),
    );
    await screen.findByText("正在识别连接方式");
    expect(authentication.revalidate).toHaveBeenCalled();
    expect(fetch.mock.calls.every(([url]) => new URL(url).pathname === Routes.Connection)).toBe(true);
    expect(screen.queryByText("已连接设备")).toBeNull();
  });

  test("a private connection requires explicit selection and an enable action", () => {
    const options = {
      ...props(),
      snapshot: {
        authorization: "authorized",
        csrfToken: "csrf",
        method: "private-network",
        canManageNetwork: true,
        privateNetwork: { state: "available" },
      },
    };
    render(React.createElement(DeviceConnectionPanel, options));
    expect(options.onEnablePrivateNetwork).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "开启私有连接" }));
    expect(options.onEnablePrivateNetwork).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("电脑服务地址")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "HTTPS 地址" }));
    expect(options.onSelectMethod).toHaveBeenCalledWith("domain");
  });
  test("domain configuration and LAN errors show the actual selected method without silent switching", () => {
    const options = { ...props(), snapshot: { authorization: "authorized", csrfToken: "csrf", method: "domain" } };
    const { rerender } = render(React.createElement(DeviceConnectionPanel, options));
    const input = screen.getByLabelText("电脑服务地址");
    fireEvent.change(input, { target: { value: "https://mine.test" } });
    fireEvent.submit(input.closest("form"));
    expect(options.onSaveAddress).toHaveBeenCalledWith("https://mine.test");
    rerender(
      React.createElement(DeviceConnectionPanel, {
        ...options,
        snapshot: {
          ...options.snapshot,
          method: "lan",
          canManageNetwork: true,
          lan: {
            state: "failed",
            port: 5140,
            interfaces: [{ name: "Wi-Fi", address: "192.168.1.2" }],
            code: "EADDRINUSE",
          },
        },
      }),
    );
    expect(screen.getByRole("alert").textContent).toContain("端口已被占用");
    expect(options.onEnablePrivateNetwork).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "开启局域网连接" }));
    expect(options.onConfigureLan).toHaveBeenCalledWith({ host: "192.168.1.2", port: 5140 });
  });
});
