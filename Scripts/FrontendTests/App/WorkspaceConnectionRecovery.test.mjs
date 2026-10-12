import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { WorkspaceConnectionRecovery } from "../../../Frontend/src/app/WorkspaceConnectionRecovery.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const workspace = { id: "7776f5b1-b0f1-4c98-a273-2f46ea4f3b53", root: "E:/senera", name: "senera" };
const catalog = { workspaces: [workspace], defaultWorkspaceId: workspace.id };

test("an unavailable connection offers registered folders without silently selecting one", async () => {
  const read = vi.fn(async () => ({ ok: true, json: async () => catalog }));
  vi.stubGlobal("fetch", read);
  const onSelect = vi.fn();
  render(React.createElement(WorkspaceConnectionRecovery, { httpBaseUrl: "http://agent.test", onSelect }));
  const select = await screen.findByRole("button", { name: /senera/ });
  expect(onSelect).not.toHaveBeenCalled();
  expect(read.mock.calls[0][0]).toBe("http://agent.test/api/workspaces");
  fireEvent.click(select);
  expect(onSelect).toHaveBeenCalledWith(workspace.id);
});

test("catalog failures are actionable and retry only when requested", async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, status: 503 })
    .mockResolvedValueOnce({ ok: true, json: async () => catalog });
  vi.stubGlobal("fetch", read);
  render(React.createElement(WorkspaceConnectionRecovery, { httpBaseUrl: "http://agent.test", onSelect: vi.fn() }));
  await screen.findByRole("alert");
  expect(read).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await screen.findByRole("button", { name: /senera/ });
  expect(read).toHaveBeenCalledTimes(2);
});
