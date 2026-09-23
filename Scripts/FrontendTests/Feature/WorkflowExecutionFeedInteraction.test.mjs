import React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { resolveWorkspaceRoot } from "../../../Scripts/WorkspaceRoot.ts";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";
import { installMemoryLocalStorage, resetFrontendStore } from "../frontendStoreTestHarness.mjs";

const { AgentExecutionFeed } = await import("../../../Frontend/src/features/workflow/AgentExecutionFeed.tsx");
const { AppMotionProvider } = await import("../../../Frontend/src/shared/motion/MotionProvider.tsx");
const { TooltipProvider } = await import("../../../Frontend/src/shared/ui/Tooltip.tsx");
const { createToolBatchRun: createUnprojectedToolBatchRun } = await import("./workflowComponentFixtures.mjs");
const { discoverAgentSystemExtensionPackages } =
  await import("../../../Source/AgentSystem/SystemTools/AgentSystemExtensionDiscovery.ts");
const { resolveAgentSystemToolPresentation } =
  await import("../../../Source/AgentSystem/SystemTools/AgentSystemToolPresentation.ts");

const SystemToolOrigins = discoverSystemToolOrigins();

function createToolBatchRun(toolNames) {
  const run = createUnprojectedToolBatchRun(toolNames);
  for (const step of run.steps) {
    if (!step.toolName || step.toolOrigin) continue;
    const origin = SystemToolOrigins.get(step.toolName);
    if (origin) step.toolOrigin = structuredClone(origin);
  }
  return run;
}

function systemToolAction(toolName) {
  const origin = SystemToolOrigins.get(toolName);
  const action = origin?.presentation?.activity?.action?.["zh-CN"];
  if (typeof action !== "string" || !action) throw new Error(`Missing zh-CN action for ${toolName}.`);
  return action;
}

function discoverSystemToolOrigins() {
  const workspaceRoot = resolveWorkspaceRoot();
  const origins = new Map();
  for (const source of discoverAgentSystemExtensionPackages(path.join(workspaceRoot, "System", "Extensions"))) {
    for (const contribution of source.manifest.contributions ?? []) {
      if (contribution.kind !== "hostTool") continue;
      const contract = JSON.parse(readFileSync(path.join(source.packageRoot, contribution.contract), "utf8"));
      origins.set(contract.name, {
        kind: "system",
        name: source.manifest.displayName["en-US"],
        capability: contribution.capability,
        presentation: resolveAgentSystemToolPresentation(
          source.domain.presentation,
          source.manifest.presentation,
          contract.presentation,
        ),
      });
    }
  }
  return origins;
}

function removeRadixPortalResidue() {
  document
    .querySelectorAll("[data-radix-popper-content-wrapper], [data-radix-focus-guard]")
    .forEach((element) => element.remove());
  document.body.style.pointerEvents = "";
  document.body.style.removeProperty("overflow");
  document.body.removeAttribute("data-scroll-locked");
}

beforeEach(() => {
  removeRadixPortalResidue();
  installMemoryLocalStorage();
  resetFrontendStore();
  vi.stubGlobal("requestAnimationFrame", (callback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (id) => window.clearTimeout(id));
});

afterEach(() => {
  cleanup();
  removeRadixPortalResidue();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test("execution feed keeps action batches summarized until the user expands them", async () => {
  const user = userEvent.setup();
  const initialRun = createToolBatchRun(["WorkspaceRead", "WorkspaceGrep"]);
  initialRun.steps.find((step) => step.toolName === "WorkspaceRead").toolArgs = { path: "Source/runtime.ts" };
  initialRun.steps.find((step) => step.toolName === "WorkspaceRead").toolResult = {
    content: "export const runtime = true;",
  };
  Object.assign(
    initialRun.steps.find((step) => step.toolName === "WorkspaceRead"),
    {
      purpose: "Inspect runtime initialization before changing the workflow.",
      toolPresentation: {
        type: "senera.tool_result_presentation.v1",
        version: 1,
        status: "success",
        headline: "Read Source/runtime.ts",
        facts: [],
        evidence: [],
        changes: [
          {
            kind: "workspace",
            status: "changed",
            key: "Source/runtime.ts",
            summary: "modified: Source/runtime.ts",
            addedLines: 6,
            removedLines: 1,
          },
        ],
      },
    },
  );
  const view = renderWithFrontendProviders(
    React.createElement(
      AppMotionProvider,
      { level: "none" },
      React.createElement(AgentExecutionFeed, { run: initialRun }),
    ),
  );
  const feed = document.querySelector("[data-execution-feed]");
  const group = document.querySelector("[data-feed-group='tools:batch-actions']");

  expect(feed).toBeInTheDocument();
  expect(feed).not.toHaveClass("rounded-xl", "border", "bg-surface-raised", "shadow-panel");
  expect(document.querySelector("[data-execution-rail]")).toBeInTheDocument();
  expect(screen.queryByText("tool_preface")).not.toBeInTheDocument();
  expect(group).toBeInstanceOf(HTMLButtonElement);
  expect(group).toHaveAttribute("aria-expanded", "false");
  expect(document.querySelector("[data-feed-detail-surface]")).not.toBeInTheDocument();
  expect(screen.queryByText("WorkspaceRead")).not.toBeInTheDocument();
  expect(screen.queryByText("WorkspaceGrep")).not.toBeInTheDocument();

  await user.click(group);
  await waitFor(() => expect(screen.getByText("WorkspaceRead")).toBeVisible());
  expect(screen.getByText("WorkspaceGrep")).toBeVisible();
  expect(screen.getByText(`${systemToolAction("WorkspaceRead")} · Source/runtime.ts`)).toBeVisible();
  expect(group).toHaveAttribute("aria-expanded", "true");
  expect(document.querySelector("[data-feed-detail-surface]")).toHaveClass("border-l", "border-line-subtle", "pl-3");
  expect(document.querySelector("[data-feed-detail-surface]")).not.toHaveClass("rounded-md", "bg-surface-subtle/70");

  expect(document.querySelector("[data-feed-tool-detail]")).not.toBeInTheDocument();
  expect(document.querySelector("[data-tool-step-inspector]")).not.toBeInTheDocument();
  expect(screen.queryByText("export const runtime = true;")).not.toBeInTheDocument();

  view.rerender(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(
        AppMotionProvider,
        { level: "none" },
        React.createElement(AgentExecutionFeed, {
          run: createToolBatchRun(["WorkspaceRead", "WorkspaceGrep", "WorkspaceList"]),
        }),
      ),
    ),
  );
  expect(screen.getByText("WorkspaceList")).toBeVisible();
  expect(document.querySelector("[data-feed-group='tools:batch-actions']")).toHaveAttribute("aria-expanded", "true");
});
