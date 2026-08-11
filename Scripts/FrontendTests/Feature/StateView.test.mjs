// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Button } from "../../../Frontend/src/shared/ui/Button.tsx";
import { InlineError, StateView } from "../../../Frontend/src/shared/ui/StateView.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("error state accepts a contextual action instead of forcing the retry convenience API", () => {
  const reconnect = vi.fn();
  const legacyRetry = vi.fn();
  render(
    React.createElement(StateView, {
      status: "error",
      title: "服务连接已中断",
      onRetry: legacyRetry,
      action: React.createElement(Button, { onClick: reconnect }, "重新连接"),
    }),
  );

  screen.getByRole("button", { name: "重新连接" }).click();
  expect(reconnect).toHaveBeenCalledOnce();
  expect(legacyRetry).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
});

test("inline errors are silent by default and opt into live announcements explicitly", () => {
  const { rerender } = render(React.createElement(InlineError, { id: "field-error" }, "供应商密钥无效"));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(document.getElementById("field-error")).toHaveTextContent("供应商密钥无效");

  rerender(React.createElement(InlineError, { announce: "polite" }, "正在检查连接"));
  expect(screen.getByRole("status")).toHaveTextContent("正在检查连接");

  rerender(React.createElement(InlineError, { announce: "assertive" }, "登录失败"));
  expect(screen.getByRole("alert")).toHaveTextContent("登录失败");
});
