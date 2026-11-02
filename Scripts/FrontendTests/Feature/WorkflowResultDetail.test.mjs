import React from "react";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";
import { installMemoryLocalStorage, resetFrontendStore } from "../frontendStoreTestHarness.mjs";
import { createStep } from "./workflowComponentFixtures.mjs";

const { controller } = vi.hoisted(() => ({ controller: { httpBaseUrl: "https://workspace.test", csrfToken: "csrf" } }));
vi.mock("../../../Frontend/src/shared/workspace/WorkspaceResourceProvider.tsx", () => ({
  useWorkspaceResourceController: () => controller,
}));
const { DataView } = await import("../../../Frontend/src/features/workflow/DataView.tsx");
const { TooltipProvider } = await import("../../../Frontend/src/shared/ui/Tooltip.tsx");
const { ToolStepInspector } = await import("../../../Frontend/src/features/workflow/ToolStepInspector.tsx");
const { readArtifactToolResult } = await import("../../../Frontend/src/api/artifactResultClient.ts");
const { frontendFeatureMessage } = await import("../../../Frontend/src/i18n/frontendFeatureMessageCatalog.ts");

const artifactUri = "senera://artifact/art_0123456789abcdef01234567";
function response(result, overrides = {}) {
  return new Response(
    JSON.stringify({
      ok: true,
      artifacts: {
        item: [
          {
            requestedUri: artifactUri,
            artifactUri: "senera://resource/abc123",
            view: "selected",
            part: "result",
            status: "found",
            content: {
              selections: [{ path: "", status: "found", value: result, representation: "original", complete: true }],
            },
            ...overrides,
          },
        ],
      },
    }),
    { status: 200 },
  );
}
function step(overrides = {}) {
  return createStep({
    kind: "tool",
    toolName: "ExampleTool",
    callId: "call-1",
    toolArgs: {},
    toolResult: { count: 3 },
    toolPresentation: { artifactUri },
    ...overrides,
  });
}
beforeEach(() => {
  installMemoryLocalStorage();
  resetFrontendStore();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("an open inspector updates from action-only history to a failure and its recovered result", async () => {
  const initial = step({ toolPresentation: undefined, toolResult: undefined, status: "failed" });
  const rendered = renderWithFrontendProviders(React.createElement(ToolStepInspector, { step: initial }));
  expect(document.querySelector('[data-tool-inspector-section="result"]')).toBeNull();
  rendered.rerender(
    React.createElement(
      TooltipProvider,
      null,
      React.createElement(ToolStepInspector, {
        step: {
          ...initial,
          toolErrorMessage: "页面加载超时",
          toolResult: { code: "Timeout" },
          toolResultAvailability: "available",
        },
      }),
    ),
  );
  expect(screen.getByText("页面加载超时")).toBeInTheDocument();
  expect(screen.getByText("Timeout")).toBeInTheDocument();
});

test.each(["available", "unavailable"])("%s history results never leave a blank inspector", (availability) => {
  renderWithFrontendProviders(
    React.createElement(ToolStepInspector, {
      step: step({ toolPresentation: undefined, toolResult: undefined, toolResultAvailability: availability }),
    }),
  );
  expect(
    screen.getByText(
      frontendFeatureMessage(
        availability === "available" ? "workflow.inspector.emptyResult" : "workflow.inspector.resultUnavailable",
      ),
    ),
  ).toBeInTheDocument();
});

test("automatically loads the full result when opening an inspector and copies the complete value", async () => {
  const user = userEvent.setup();
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const full = { count: 3, extra: "full durable payload" };
  const fetcher = vi.fn().mockResolvedValue(response(full));
  vi.stubGlobal("fetch", fetcher);
  renderWithFrontendProviders(React.createElement(ToolStepInspector, { step: step() }));
  await screen.findByText(full.extra);
  expect(fetcher).toHaveBeenCalledOnce();
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toContain("https://workspace.test/");
  expect(init).toMatchObject({ credentials: "include", headers: { "X-Senera-Csrf": "csrf" } });
  expect(JSON.parse(init.body)).toEqual({ requests: [{ uri: artifactUri, part: "result", paths: [""] }] });
  await user.click(screen.getByRole("button", { name: frontendFeatureMessage("workflow.inspector.copyResult") }));
  expect(write).toHaveBeenCalledWith(JSON.stringify(full, null, 2));
});

test("shows a real artifact error and allows retry without replacing the visible result", async () => {
  const user = userEvent.setup();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: { message: "Result expired" } }), { status: 404 }),
    )
    .mockResolvedValueOnce(response({ restored: "Recovered result" }));
  vi.stubGlobal("fetch", fetcher);
  renderWithFrontendProviders(React.createElement(ToolStepInspector, { step: step() }));
  await screen.findByText("Result expired");
  expect(document.querySelector('[data-tool-inspector-section="result"]')).toHaveTextContent("3");
  await user.click(screen.getByRole("button", { name: "重试" }));
  await screen.findByText("Recovered result");
  expect(screen.queryByText("Result expired")).not.toBeInTheDocument();
});

test("aborts an in-flight artifact request when selecting a different tool", async () => {
  const pending = [];
  const fetcher = vi.fn((_url, init) => {
    pending.push(init.signal);
    return new Promise(() => {});
  });
  vi.stubGlobal("fetch", fetcher);
  const rendered = renderWithFrontendProviders(React.createElement(ToolStepInspector, { step: step() }));
  expect(pending[0].aborted).toBe(false);
  rendered.rerender(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(ToolStepInspector, {
        step: step({
          id: "step-2",
          callId: "call-2",
          toolPresentation: undefined,
          toolResult: { next: "different tool" },
        }),
      }),
    ),
  );
  await waitFor(() => expect(pending[0].aborted).toBe(true));
  expect(screen.getByText("different tool")).toBeInTheDocument();
});

test("rejects a mismatched artifact response instead of displaying another tool's result", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(response({ secret: "other result" }, { requestedUri: "senera://resource/other1" })),
  );
  await expect(readArtifactToolResult(controller.httpBaseUrl, artifactUri)).rejects.toThrow("does not match");
});

test("rerendering progress does not refetch, and tools without an archive render directly", async () => {
  const fetcher = vi.fn().mockResolvedValue(response({ value: "Complete result" }));
  vi.stubGlobal("fetch", fetcher);
  const rendered = renderWithFrontendProviders(React.createElement(ToolStepInspector, { step: step() }));
  await screen.findByText("Complete result");
  rendered.rerender(
    React.createElement(
      TooltipProvider,
      null,
      React.createElement(ToolStepInspector, { step: step({ status: "done" }) }),
    ),
  );
  expect(fetcher).toHaveBeenCalledOnce();
  rendered.rerender(
    React.createElement(
      TooltipProvider,
      null,
      React.createElement(ToolStepInspector, {
        step: step({ callId: "inline", toolPresentation: undefined, toolResult: { text: "Inline result" } }),
      }),
    ),
  );
  expect(screen.getByText("Inline result")).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledOnce();
});

test.each(["array", "object"])("renders a large %s incrementally and keeps every entry accessible", async (kind) => {
  const user = userEvent.setup();
  const values = Array.from({ length: 95 }, (_, index) => `entry-${index}`);
  const value = kind === "array" ? values : Object.fromEntries(values.map((entry, index) => [`field${index}`, entry]));
  renderWithFrontendProviders(React.createElement(DataView, { value }));
  expect(screen.getByText("entry-39")).toBeInTheDocument();
  expect(screen.queryByText("entry-40")).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: frontendFeatureMessage("workflow.data.showMore", { count: 55 }) }),
  );
  expect(screen.getByText("entry-79")).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: frontendFeatureMessage("workflow.data.showMore", { count: 15 }) }),
  );
  expect(screen.getByText("entry-94")).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
