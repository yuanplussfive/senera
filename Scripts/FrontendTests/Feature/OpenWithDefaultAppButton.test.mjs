// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { clearTestToastCalls, readTestToastCalls } from "sonner";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

const { OpenWithDefaultAppButton } = await import("../../../Frontend/src/shared/media/OpenWithDefaultAppButton.tsx");
const { frontendMessage } = await import("../../../Frontend/src/i18n/frontendMessageCatalog.ts");

const source = "http://127.0.0.1:8788/api/workspace/content?path=report.docx";

beforeEach(() => {
  clearTestToastCalls();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.seneraDesktop = undefined;
});

function bridge(openFileExternally) {
  return { isDesktop: true, openFileExternally };
}

test("stays absent outside the desktop app", () => {
  const view = renderWithFrontendProviders(
    React.createElement(OpenWithDefaultAppButton, { name: "report.docx", source, variant: "labeled" }),
  );

  expect(view.container.querySelectorAll("button")).toHaveLength(0);
});

test("stays absent when the surface has no resource URL to fetch", () => {
  window.seneraDesktop = bridge(vi.fn());
  const view = renderWithFrontendProviders(
    React.createElement(OpenWithDefaultAppButton, { name: "report.docx", variant: "labeled" }),
  );

  expect(view.container.querySelectorAll("button")).toHaveLength(0);
});

test("hands the fetched resource bytes to the desktop app", async () => {
  const openFileExternally = vi.fn().mockResolvedValue({ ok: true });
  window.seneraDesktop = bridge(openFileExternally);
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => new Uint8Array([7, 8, 9]).buffer,
  });
  vi.stubGlobal("fetch", fetchMock);

  const view = renderWithFrontendProviders(
    React.createElement(OpenWithDefaultAppButton, { name: "report.docx", source, variant: "labeled" }),
  );
  const button = view.container.querySelector("[data-senera-button]");
  expect(button?.textContent).toContain(frontendMessage("resource.openWithDefaultApp"));

  fireEvent.click(button);

  await waitFor(() => expect(openFileExternally).toHaveBeenCalledTimes(1));
  expect(fetchMock).toHaveBeenCalledWith(source, { credentials: "include" });
  expect(openFileExternally.mock.calls[0][0].name).toBe("report.docx");
  expect(Array.from(openFileExternally.mock.calls[0][0].bytes)).toEqual([7, 8, 9]);
  expect(readTestToastCalls()).toHaveLength(0);
});

test("reports a failed handoff instead of failing silently", async () => {
  const openFileExternally = vi.fn().mockResolvedValue({ ok: false, code: "open-failed" });
  window.seneraDesktop = bridge(openFileExternally);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }));

  const view = renderWithFrontendProviders(
    React.createElement(OpenWithDefaultAppButton, { name: "report.docx", source }),
  );
  fireEvent.click(view.container.querySelector(`[aria-label="${frontendMessage("resource.openWithDefaultApp")}"]`));

  await waitFor(() => expect(readTestToastCalls()).toHaveLength(1));
  expect(readTestToastCalls()[0]).toEqual(
    expect.objectContaining({
      variant: "error",
      title: frontendMessage("resource.openWithDefaultAppFailed"),
    }),
  );
});

test("reports a failed fetch without invoking the desktop bridge", async () => {
  const openFileExternally = vi.fn();
  window.seneraDesktop = bridge(openFileExternally);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

  const view = renderWithFrontendProviders(
    React.createElement(OpenWithDefaultAppButton, { name: "report.docx", source }),
  );
  fireEvent.click(view.container.querySelector(`[aria-label="${frontendMessage("resource.openWithDefaultApp")}"]`));

  await waitFor(() => expect(readTestToastCalls()).toHaveLength(1));
  expect(openFileExternally).not.toHaveBeenCalled();
});
