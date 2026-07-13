import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

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
    expect(fallback).toHaveTextContent("Something went wrong");
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

function ThrowingChild({ shouldThrow }) {
  if (shouldThrow) {
    const error = new Error("private diagnostic");
    error.stack = "private diagnostic stack";
    throw error;
  }
  return React.createElement("span", null, "Recovered session");
}
