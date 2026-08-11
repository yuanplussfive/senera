import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";

const { ErrorBoundary } = await import("../../../Frontend/src/shared/ui/ErrorBoundary.tsx");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("error boundary hides diagnostics and resets after its key changes", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const preventExpectedError = (event) => event.preventDefault();
  window.addEventListener("error", preventExpectedError);

  try {
    const { rerender } = render(
      React.createElement(
        ErrorBoundary,
        { resetKey: "session-a" },
        React.createElement(ThrowingChild, { shouldThrow: true }),
      ),
    );

    const fallback = screen.getByRole("alert");
    expect(fallback).toHaveTextContent(frontendMessage("app.errorBoundary.title"));
    expect(fallback).not.toHaveTextContent("private diagnostic");
    expect(fallback).not.toHaveTextContent("private diagnostic stack");

    rerender(
      React.createElement(
        ErrorBoundary,
        { resetKey: "session-b" },
        React.createElement(ThrowingChild, { shouldThrow: false }),
      ),
    );

    await waitFor(() => expect(screen.getByText("Recovered session")).toBeInTheDocument());
  } finally {
    window.removeEventListener("error", preventExpectedError);
  }
});

test("component presentation avoids main landmarks and uses a unique labelled alert", () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const preventExpectedError = (event) => event.preventDefault();
  window.addEventListener("error", preventExpectedError);

  try {
    render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(ErrorBoundary, null, React.createElement(ThrowingChild, { shouldThrow: true })),
        React.createElement(ErrorBoundary, null, React.createElement(ThrowingChild, { shouldThrow: true })),
      ),
    );

    expect(screen.queryByRole("main")).not.toBeInTheDocument();
    const alerts = screen.getAllByRole("alert");
    const labelledBy = alerts.map((alert) => alert.getAttribute("aria-labelledby"));
    expect(labelledBy.every(Boolean)).toBe(true);
    expect(new Set(labelledBy).size).toBe(alerts.length);
    for (const id of labelledBy) expect(document.getElementById(id)).toBeInTheDocument();
  } finally {
    window.removeEventListener("error", preventExpectedError);
  }
});

test("app presentation provides localized retry and reload actions", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const reload = vi.fn();
  const preventExpectedError = (event) => event.preventDefault();
  window.addEventListener("error", preventExpectedError);

  try {
    render(
      React.createElement(
        ErrorBoundary,
        { presentation: "app", reload },
        React.createElement(ThrowingChild, { shouldThrow: true }),
      ),
    );

    expect(screen.getByRole("heading", { name: frontendMessage("app.errorBoundary.title") })).toBeInTheDocument();
    await screen.getByRole("button", { name: frontendMessage("app.errorBoundary.reload") }).click();
    expect(reload).toHaveBeenCalledOnce();
  } finally {
    window.removeEventListener("error", preventExpectedError);
  }
});

test("notifies the owner when the retry action resets the boundary", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const onReset = vi.fn();
  const preventExpectedError = (event) => event.preventDefault();
  window.addEventListener("error", preventExpectedError);

  try {
    render(React.createElement(ErrorBoundary, { onReset }, React.createElement(ThrowingChild, { shouldThrow: true })));

    await screen.getByRole("button", { name: frontendMessage("app.errorBoundary.retry") }).click();

    expect(onReset).toHaveBeenCalledOnce();
  } finally {
    window.removeEventListener("error", preventExpectedError);
  }
});

function ThrowingChild({ shouldThrow }) {
  if (shouldThrow) {
    const error = new Error("private diagnostic");
    error.stack = "private diagnostic stack";
    throw error;
  }
  return React.createElement("span", null, "Recovered session");
}
