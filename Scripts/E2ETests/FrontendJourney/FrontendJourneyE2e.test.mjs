// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WebSocket as NodeWebSocket } from "ws";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";
import { useStore } from "../../../Frontend/src/store/sessionStore.ts";
import { resetFrontendStore } from "../../FrontendTests/frontendStoreTestHarness.mjs";
import { createAgentProtocolE2eHarness } from "../AgentProtocol/AgentProtocolE2eHarness.ts";

let harness = null;

beforeAll(async () => {
  harness = await createAgentProtocolE2eHarness();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

afterAll(() => {
  harness?.stop();
  harness = null;
});

test("the complete UI sends a message and restores the server-owned conversation after remount", async () => {
  installBrowserRuntime();
  resetFrontendStore();
  window.__SENERA_RUNTIME_CONFIG__ = {
    webSocketUrl: harness.websocketUrl,
    emptySuggestions: [],
  };

  const { App } = await import("../../../Frontend/src/App.tsx");
  const firstMount = render(React.createElement(App));
  const composer = await screen.findByPlaceholderText("跟 senera 说点什么");
  const user = userEvent.setup();

  await user.type(composer, "验证完整界面链路{enter}");

  await waitFor(() => {
    const state = useStore.getState();
    const session = state.activeSessionId ? state.sessions[state.activeSessionId] : undefined;
    expect(session?.runs.at(-1)).toMatchObject({
      requestId: expect.any(String),
      status: "completed",
    });
  });
  await waitFor(() => {
    expectVisibleText("验证完整界面链路");
    expectVisibleText("E2E response: 验证完整界面链路");
  });

  firstMount.unmount();
  resetFrontendStore();
  render(React.createElement(App));

  await waitFor(() => {
    expectVisibleText("验证完整界面链路");
    expectVisibleText("E2E response: 验证完整界面链路");
  });
  await waitFor(() => {
    const state = useStore.getState();
    expect(state.activeSessionId).toEqual(expect.any(String));
    expect(state.historyLoadedIds[state.activeSessionId]).toBe(true);
  });
});

test("switching recovered sessions keeps each server-owned conversation isolated", async () => {
  installBrowserRuntime();
  resetFrontendStore();
  await createPersistedConversation("session_alpha", "alpha only");
  await createPersistedConversation("session_beta", "beta only");
  window.__SENERA_RUNTIME_CONFIG__ = {
    webSocketUrl: harness.websocketUrl,
    emptySuggestions: [],
  };

  const { App } = await import("../../../Frontend/src/App.tsx");
  render(React.createElement(App));
  const user = userEvent.setup();

  await waitFor(() => {
    expect(useStore.getState().sessionOrder).toEqual(expect.arrayContaining(["session_alpha", "session_beta"]));
  });
  await user.click(screen.getByRole("button", { name: frontendMessage("session.headerExpand") }));
  await user.click(await screen.findByRole("button", { name: "打开会话：alpha only" }));
  await waitFor(() => {
    expectVisibleText("E2E response: alpha only");
  });
  await waitFor(() => {
    expect(useStore.getState().activeSessionId).toBe("session_alpha");
    expect(useStore.getState().historyLoadedIds.session_alpha).toBe(true);
  });

  await user.click(screen.getByRole("button", { name: frontendMessage("session.headerExpand") }));
  await user.click(await screen.findByRole("button", { name: "打开会话：beta only" }));
  await waitFor(() => {
    expectVisibleText("E2E response: beta only");
  });
  await waitFor(() => {
    expect(useStore.getState().activeSessionId).toBe("session_beta");
    expect(useStore.getState().historyLoadedIds.session_beta).toBe(true);
  });
  expect(screen.queryByText("E2E response: alpha only")).not.toBeInTheDocument();
});

async function createPersistedConversation(sessionId, input) {
  const client = harness.client;
  const beforeCreate = client.snapshot().at(-1)?.sequence ?? 0;
  client.send({ type: "session.create", sessionId });
  await client.waitForEvent("session.created", (event) => event.sessionId === sessionId, {
    afterSequence: beforeCreate,
  });

  const beforeMessage = client.snapshot().at(-1)?.sequence ?? 0;
  client.send({
    type: "session.message",
    sessionId,
    requestId: `${sessionId}:request`,
    input,
  });
  await client.waitForEvent("run.completed", (event) => event.sessionId === sessionId, {
    afterSequence: beforeMessage,
  });
}

function installBrowserRuntime() {
  vi.stubGlobal("WebSocket", NodeWebSocket);
  vi.stubGlobal("requestAnimationFrame", (callback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (id) => window.clearTimeout(id));
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
}
function expectVisibleText(text) {
  const visible = screen.getAllByText(text).find((element) => !element.closest('[aria-hidden="true"]'));
  expect(visible).toBeDefined();
  expect(visible).toBeVisible();
}
