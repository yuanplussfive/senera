import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { AppErrorBoundary } from "../../../Frontend/src/app/AppErrorBoundary.tsx";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("app error boundary shows localized fallback without leaking error details", () => {
  const stopErrorLogging = suppressExpectedReactRenderErrors();
  const onError = vi.fn();

  render(React.createElement(AppErrorBoundary, { onError }, React.createElement(CrashView)));

  expect(screen.getByRole("heading", { name: frontendMessage("app.errorBoundary.title") })).toBeInTheDocument();
  expect(screen.getByText(frontendMessage("app.errorBoundary.description"))).toBeInTheDocument();
  expect(screen.queryByText("private stack token")).not.toBeInTheDocument();
  expect(onError).toHaveBeenCalledOnce();
  expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  stopErrorLogging();
});

test("app error boundary can retry rendering after the failing child recovers", async () => {
  const stopErrorLogging = suppressExpectedReactRenderErrors();
  let shouldThrow = true;

  function FlakyView() {
    if (shouldThrow) {
      throw new Error("temporary failure");
    }
    return React.createElement("div", null, "Recovered view");
  }

  render(React.createElement(AppErrorBoundary, null, React.createElement(FlakyView)));

  shouldThrow = false;
  await userEvent.setup().click(screen.getByRole("button", { name: frontendMessage("app.errorBoundary.retry") }));

  expect(screen.getByText("Recovered view")).toBeInTheDocument();
  stopErrorLogging();
});

test("app error boundary delegates reload to the configured handler", async () => {
  const stopErrorLogging = suppressExpectedReactRenderErrors();
  const reload = vi.fn();

  render(React.createElement(AppErrorBoundary, { reload }, React.createElement(CrashView)));

  await userEvent.setup().click(screen.getByRole("button", { name: frontendMessage("app.errorBoundary.reload") }));

  expect(reload).toHaveBeenCalledOnce();
  stopErrorLogging();
});

function CrashView() {
  throw new Error("private stack token");
}

function suppressExpectedReactRenderErrors() {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const onError = (event) => {
    event.preventDefault();
  };
  window.addEventListener("error", onError);
  return () => {
    window.removeEventListener("error", onError);
    consoleError.mockRestore();
  };
}
