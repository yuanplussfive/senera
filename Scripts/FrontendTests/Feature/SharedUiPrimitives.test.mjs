// @vitest-environment jsdom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearTestToastCalls, readTestToastCalls } from "sonner";
import { shouldMountSheetChildren } from "../../../Frontend/src/shared/ui/Sheet.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../Frontend/src/shared/ui/Tabs.tsx";
import { notifyError } from "../../../Frontend/src/shared/ui/notifyError.ts";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

const { TextShimmer } = await import("../../../Frontend/src/shared/motion/textShimmer.tsx");
const { AppMotionProvider } = await import("../../../Frontend/src/shared/motion/MotionProvider.tsx");
const { ModelProviderIcon, ModelProviderIconNames, readModelProviderIconSrc } =
  await import("../../../Frontend/src/shared/models/ModelProviderIcon.tsx");

beforeEach(() => {
  clearTestToastCalls();
});

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.motionLevel;
  vi.restoreAllMocks();
});

test("sheet children wait for deferred opening and remain mounted through closing", () => {
  expect(shouldMountSheetChildren({ dataState: "open", deferContentMount: true, contentReady: false })).toBe(false);
  expect(shouldMountSheetChildren({ dataState: "open", deferContentMount: true, contentReady: true })).toBe(true);
  expect(shouldMountSheetChildren({ dataState: "closed", deferContentMount: true, contentReady: true })).toBe(true);
  expect(shouldMountSheetChildren({ dataState: "closed", deferContentMount: true, contentReady: false })).toBe(false);
});

test("controlled tabs switch content by click and expose linked tabpanel semantics", async () => {
  const onValueChange = vi.fn();

  function Harness() {
    const [value, setValue] = React.useState("execution");
    return React.createElement(
      Tabs,
      {
        value,
        onValueChange: (nextValue) => {
          onValueChange(nextValue);
          setValue(nextValue);
        },
      },
      React.createElement(
        TabsList,
        { "aria-label": "工作区" },
        React.createElement(TabsTrigger, { value: "execution" }, "执行"),
        React.createElement(TabsTrigger, { value: "terminal" }, "终端"),
      ),
      React.createElement(TabsContent, { value: "execution" }, "执行内容"),
      React.createElement(TabsContent, { value: "terminal" }, "终端内容"),
    );
  }

  render(React.createElement(Harness));
  const terminalTab = screen.getByRole("tab", { name: "终端" });
  const user = userEvent.setup();

  expect(screen.getByRole("tab", { name: "执行" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tabpanel")).toHaveTextContent("执行内容");
  expect(screen.queryByText("终端内容")).not.toBeInTheDocument();

  await user.click(terminalTab);

  expect(onValueChange).toHaveBeenCalledWith("terminal");
  expect(terminalTab).toHaveAttribute("aria-selected", "true");
  const terminalPanel = screen.getByRole("tabpanel");
  expect(terminalPanel).toHaveTextContent("终端内容");
  expect(terminalTab).toHaveAttribute("aria-controls", terminalPanel.id);
});

describe("error toast actions", () => {
  test("ordinary errors do not expose diagnostic copying", () => {
    notifyError({ title: "Unable to save", description: "Check the highlighted fields" });

    expect(readTestToastCalls()[0]?.options?.action).toBeUndefined();
    expect(readTestToastCalls()[0]?.options?.cancel).toBeUndefined();
  });

  test("diagnostic copying is explicit and never occupies the cancel slot", () => {
    notifyError({
      title: "Tool call failed",
      description: "exit 1",
      diagnosticText: "Tool call failed\nexit 1",
    });

    const options = readTestToastCalls()[0]?.options;
    expect(options?.action).toEqual(expect.objectContaining({ label: expect.any(String) }));
    expect(options?.cancel).toBeUndefined();
  });

  test("a primary recovery action is not displaced by diagnostic copying", () => {
    const retry = { label: "Retry", onClick: vi.fn() };
    notifyError({
      title: "Request failed",
      action: retry,
      diagnosticText: "Request failed\ntrace",
    });

    const options = readTestToastCalls()[0]?.options;
    expect(options?.action).toBe(retry);
    expect(options?.cancel).toBeUndefined();
  });
});

test("sweeps the whole text on a single continuous element while active", () => {
  const view = renderWithFrontendProviders(
    React.createElement(TextShimmer, { text: "Plan\nInspect\nReport", active: true }),
  );

  const shimmering = view.container.querySelectorAll(".animate-text-shimmer");
  expect(shimmering).toHaveLength(1);
  expect(shimmering[0]).toHaveAttribute("data-text-shimmer", "true");
  expect(shimmering[0]).toHaveTextContent("Plan");
  expect(shimmering[0]).toHaveTextContent("Report");
});

test("renders plain text without the sweep when inactive", () => {
  const view = renderWithFrontendProviders(React.createElement(TextShimmer, { text: "Idle", active: false }));

  expect(view.container.querySelector("[data-text-shimmer]")).toBeNull();
  expect(view.container.querySelector(".animate-text-shimmer")).toBeNull();
  expect(view.container).toHaveTextContent("Idle");
});

test("disables the sweep for reduced motion", () => {
  const view = render(
    React.createElement(
      AppMotionProvider,
      { level: "reduced" },
      React.createElement(TextShimmer, { text: "One\nTwo", active: true }),
    ),
  );

  expect(view.container.querySelector("[data-text-shimmer]")).toBeNull();
  expect(view.container.querySelector(".animate-text-shimmer")).toBeNull();
});

test("model provider icon choices are unique", () => {
  expect(new Set(ModelProviderIconNames).size).toBe(ModelProviderIconNames.length);
});

test("only declared monochrome assets adapt to dark mode; custom logos keep their colors", () => {
  expect(renderToStaticMarkup(React.createElement(ModelProviderIcon, { icon: "openai" }))).toContain(
    "data-model-provider-monochrome",
  );
  expect(renderToStaticMarkup(React.createElement(ModelProviderIcon, { icon: "deepseek" }))).not.toContain(
    "data-model-provider-monochrome",
  );
  expect(renderToStaticMarkup(React.createElement(ModelProviderIcon, { icon: "/profile/logo.png" }))).not.toContain(
    "data-model-provider-monochrome",
  );
});

test("model provider icon sources stay inside the bundled icon allow-list", () => {
  expect(readModelProviderIconSrc("openai", "/app/")).toBe("/app/icons/model-providers/openai.svg");
  expect(readModelProviderIconSrc("OPENAI.svg", "/app/")).toBe("/app/icons/model-providers/openai.svg");
  expect(readModelProviderIconSrc('/evil.svg?x=" onerror="alert(1)', "/app/")).toBe(
    "/app/icons/model-providers/sparkles.svg",
  );
  expect(readModelProviderIconSrc("https://cdn.example.test/provider.svg", "/app/")).toBe(
    "https://cdn.example.test/provider.svg",
  );
  expect(readModelProviderIconSrc("data:image/png;base64,aW1hZ2U=", "/app/")).toBe("data:image/png;base64,aW1hZ2U=");
  expect(readModelProviderIconSrc("data:image/svg+xml;base64,PHN2Zy8+", "/app/")).toBe(
    "/app/icons/model-providers/sparkles.svg",
  );
  expect(readModelProviderIconSrc("javascript:alert(1)", "/app/")).toBe("/app/icons/model-providers/sparkles.svg");
  expect(readModelProviderIconSrc(String.fromCharCode(0xd800), "/app/")).toBe(
    "/app/icons/model-providers/sparkles.svg",
  );
  expect(readModelProviderIconSrc("//cdn.example.test/provider.svg", "/app/")).toBe(
    "/app/icons/model-providers/sparkles.svg",
  );
});
