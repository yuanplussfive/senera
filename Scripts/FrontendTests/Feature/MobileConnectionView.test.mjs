// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MobileConnectionView } from "../../../Frontend/src/mobile/MobileConnectionView.tsx";
afterEach(cleanup);
const props = () => ({
  serverUrl: "https://computer.test",
  deviceName: "我的手机",
  loginName: "owner",
  password: "password",
  busy: false,
  waiting: false,
  error: "",
  connections: [],
  onField: vi.fn(),
  onLogin: vi.fn(),
  onScan: vi.fn(),
  onCancel: vi.fn(),
  onConnect: vi.fn(),
  onForget: vi.fn(),
});
describe("mobile account and QR login", () => {
  test("restoring the paired device shows recovery instead of a misleading login page", () => {
    const options = { ...props(), restoring: true, busy: true };
    const { rerender } = render(React.createElement(MobileConnectionView, options));
    expect(screen.getByRole("status").textContent).toContain("正在恢复上次连接");
    expect(screen.queryByRole("button", { name: "扫码登录" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(options.onCancel).toHaveBeenCalledOnce();
    rerender(
      React.createElement(MobileConnectionView, { ...options, restoring: false, busy: false, error: "连接失败" }),
    );
    expect(screen.getByRole("button", { name: "扫码登录" }).disabled).toBe(false);
    expect(screen.getByRole("alert").textContent).toBe("连接失败");
  });
  test("provides separate password and scanner actions without forcing account credentials for a scan", () => {
    const options = props();
    render(React.createElement(MobileConnectionView, options));
    fireEvent.click(screen.getByRole("button", { name: "扫码登录" }));
    expect(options.onScan).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText("使用账号密码"));
    fireEvent.submit(screen.getByRole("button", { name: "账号密码登录" }).closest("form"));
    expect(options.onLogin).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("电脑服务地址").getAttribute("inputmode")).toBe("url");
  });
  test("shows the confirmation state with cancellation and prevents another concurrent login", () => {
    const options = { ...props(), busy: true, waiting: true };
    render(React.createElement(MobileConnectionView, options));
    expect(screen.getByRole("status").textContent).toContain("请在电脑上确认");
    expect(screen.getByRole("button", { name: "扫码登录" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(options.onCancel).toHaveBeenCalledOnce();
  });
  test("opens background permissions separately without starting a scan or logging in", () => {
    const options = { ...props(), onBackgroundSettings: vi.fn() };
    render(React.createElement(MobileConnectionView, options));
    fireEvent.click(screen.getByRole("button", { name: "后台与悬浮窗" }));
    expect(options.onBackgroundSettings).toHaveBeenCalledOnce();
    expect(options.onScan).not.toHaveBeenCalled();
    expect(options.onLogin).not.toHaveBeenCalled();
  });
});
