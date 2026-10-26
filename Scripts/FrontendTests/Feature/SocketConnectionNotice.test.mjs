import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";

const { SocketConnectionNotice } = await import("../../../Frontend/src/features/session/SocketConnectionNotice.tsx");
const { readSocketConnectionPresentation } =
  await import("../../../Frontend/src/features/session/socketConnectionPresentation.ts");

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderNotice({ status, onReconnect, collapsed = false }) {
  return renderWithFrontendProviders(React.createElement(SocketConnectionNotice, { status, onReconnect, collapsed }));
}

test("an open socket stays silent until it has recovered", () => {
  renderNotice({ status: "open" });

  expect(document.querySelector("[data-socket-connection-notice]")).not.toBeInTheDocument();
});

test("a degraded socket names its state and offers an immediate retry", () => {
  const onReconnect = vi.fn();
  renderNotice({ status: "closed", onReconnect });

  expect(screen.getByText(frontendMessage("connection.closed"))).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: frontendMessage("connection.reconnect") }));
  expect(onReconnect).toHaveBeenCalledTimes(1);
});

test("connecting and error states stay distinguishable", () => {
  expect(readSocketConnectionPresentation("connecting")).toMatchObject({
    tone: "pending",
    messageKey: "connection.connecting",
    retryable: true,
  });
  expect(readSocketConnectionPresentation("error")).toMatchObject({
    tone: "danger",
    messageKey: "connection.error",
  });
  expect(readSocketConnectionPresentation("idle")).toBeNull();
});

test("recovery confirms itself briefly and then goes quiet", () => {
  vi.useFakeTimers();
  const { rerender } = render(React.createElement(SocketConnectionNotice, { status: "connecting" }));
  act(() => {
    rerender(React.createElement(SocketConnectionNotice, { status: "open" }));
  });
  expect(screen.queryByText(frontendMessage("connection.open"))).not.toBeInTheDocument();

  act(() => {
    rerender(React.createElement(SocketConnectionNotice, { status: "closed" }));
  });
  expect(screen.getByText(frontendMessage("connection.closed"))).toBeInTheDocument();

  act(() => {
    rerender(React.createElement(SocketConnectionNotice, { status: "open" }));
  });
  expect(screen.getByText(frontendMessage("connection.open"))).toBeInTheDocument();

  act(() => {
    vi.advanceTimersByTime(2000);
  });
  expect(screen.queryByText(frontendMessage("connection.open"))).not.toBeInTheDocument();
});

test("a collapsed sidebar keeps a retry control for a degraded socket", () => {
  const onReconnect = vi.fn();
  renderNotice({ status: "closed", onReconnect, collapsed: true });

  const retry = screen.getByRole("button", {
    name: `${frontendMessage("connection.closed")} · ${frontendMessage("connection.reconnect")}`,
  });
  fireEvent.click(retry);
  expect(onReconnect).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(frontendMessage("connection.closed"))).not.toBeInTheDocument();
});
