import React from "react";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

vi.mock("../../../Frontend/src/shared/ui/Tooltip.tsx", () => ({
  TooltipProvider: ({ children }) => React.createElement(React.Fragment, null, children),
  Tooltip: ({ children }) => React.createElement(React.Fragment, null, children),
}));

const { ChatComposer } = await import("../../../Frontend/src/features/chat/ChatComposer.tsx");
const { FrontendLocales } = await import("../../../Frontend/src/i18n/frontendMessageCatalog.ts");
const { setFrontendLocale } = await import("../../../Frontend/src/i18n/frontendLocaleStore.ts");
const { clearPersistedStore } = await import("../../../Frontend/src/store/sessionStore.ts");
const { createComposerProps, withUploadPreviewProvider } = await import("./chatCoreComponentFixtures.mjs");

beforeEach(() => {
  setFrontendLocale(FrontendLocales.ZhCn);
});

afterEach(() => {
  cleanup();
  setFrontendLocale(FrontendLocales.ZhCn);
  vi.clearAllMocks();
  vi.restoreAllMocks();
  clearPersistedStore();
});

test("chat model selector keeps the current conversation choice and exposes the current default", async () => {
  const onApplyDefaultModel = vi.fn();
  const onAddModel = vi.fn();
  const user = userEvent.setup();
  renderWithFrontendProviders(
    withUploadPreviewProvider(
      React.createElement(
        ChatComposer,
        createComposerProps({
          modelConfig: {
            modelProviders: [
              {
                id: "openai:gpt-4o",
                icon: "openai",
                capabilities: { Chat: true },
                model: "gpt-4o",
                isDefault: false,
              },
              {
                id: "anthropic:sonnet",
                icon: "anthropic",
                capabilities: { Chat: true },
                model: "claude-sonnet",
                isDefault: true,
              },
            ],
            selectedModelProviderId: "openai:gpt-4o",
            defaultModelProviderId: "anthropic:sonnet",
            onSelectModelProvider: vi.fn(),
            onApplyDefaultModel,
            onAddModel,
          },
        }),
      ),
    ),
  );

  expect(screen.getByRole("button", { name: "选择模型" })).not.toHaveClass("focus:ring-2");
  expect(document.querySelector("[data-composer-trailing-controls]")).toContainElement(
    document.querySelector("[data-composer-model-selector]"),
  );

  await user.click(screen.getByRole("button", { name: "选择模型" }));
  expect(screen.getByText("当前对话模型")).toBeInTheDocument();
  expect(screen.getByText("默认模型：claude-sonnet")).toBeInTheDocument();
  expect(screen.getByRole("group")).toHaveClass("overflow-y-auto");
  await user.click(screen.getByRole("menuitem", { name: "恢复为默认" }));
  expect(onApplyDefaultModel).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole("button", { name: "选择模型" }));
  await user.click(screen.getByRole("menuitem", { name: "添加模型" }));
  expect(onAddModel).toHaveBeenCalledTimes(1);
});

test("chat model selector follows the configured default for a conversation without its own model", async () => {
  const user = userEvent.setup();
  renderWithFrontendProviders(
    withUploadPreviewProvider(
      React.createElement(
        ChatComposer,
        createComposerProps({
          modelConfig: {
            modelProviders: [
              {
                id: "openai:gpt-4o",
                icon: "openai",
                capabilities: { Chat: true },
                model: "gpt-4o",
                isDefault: false,
              },
              {
                id: "anthropic:sonnet",
                icon: "anthropic",
                capabilities: { Chat: true },
                model: "claude-sonnet",
                isDefault: true,
              },
            ],
            selectedModelProviderId: null,
            defaultModelProviderId: "anthropic:sonnet",
            onSelectModelProvider: vi.fn(),
            onApplyDefaultModel: vi.fn(),
          },
        }),
      ),
    ),
  );

  expect(document.querySelector("[data-composer-model-selector]")).toHaveTextContent("claude-sonnet");
  await user.click(screen.getByRole("button", { name: "选择模型" }));

  const inheritedItem = screen.getByRole("menuitem", { name: "claude-sonnet" });
  expect(inheritedItem.firstElementChild?.querySelector("img")).not.toBeNull();
  expect(inheritedItem.lastElementChild?.querySelector("svg")).not.toBeNull();
  const otherItem = screen.getByRole("menuitem", { name: "gpt-4o" });
  expect(otherItem.firstElementChild?.querySelector("img")).not.toBeNull();
  expect(otherItem.lastElementChild?.querySelector("svg")).toBeNull();
  expect(screen.queryByRole("menuitem", { name: "恢复为默认" })).not.toBeInTheDocument();
});

test("chat model selector keeps reasoning levels in the model menu", async () => {
  const onSelectThinkingLevel = vi.fn();
  const user = userEvent.setup();
  renderWithFrontendProviders(
    withUploadPreviewProvider(
      React.createElement(
        ChatComposer,
        createComposerProps({
          modelConfig: {
            modelProviders: [
              {
                id: "openai:reasoning",
                capabilities: { Chat: true, Reasoning: true },
                model: "reasoning-model",
                isDefault: true,
                thinkingLevels: ["off", "low", "high"],
                thinkingProfiles: [{ id: "deep", label: "深度", level: "high" }],
                defaultThinkingLevel: "low",
              },
            ],
            selectedModelProviderId: "openai:reasoning",
            selectedThinkingLevel: "low",
            onSelectModelProvider: vi.fn(),
            onSelectThinkingLevel,
          },
        }),
      ),
    ),
  );

  expect(document.querySelector("[data-composer-thinking-selector]")).toBeNull();
  await user.click(screen.getByRole("button", { name: "选择模型" }));
  expect(screen.getByText("推理等级")).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "low" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "深度" })).toBeInTheDocument();
  expect(screen.getByRole("menu")).toHaveClass("grid-cols-[minmax(220px,1fr)_minmax(140px,auto)]");
  await user.click(screen.getByRole("menuitem", { name: "深度" }));
  expect(onSelectThinkingLevel).toHaveBeenCalledWith("high");
});

test("chat model selector stays available for adding the first model", async () => {
  const onAddModel = vi.fn();
  const user = userEvent.setup();
  renderWithFrontendProviders(
    withUploadPreviewProvider(
      React.createElement(
        ChatComposer,
        createComposerProps({
          modelConfig: {
            modelProviders: [],
            selectedModelProviderId: null,
            onSelectModelProvider: vi.fn(),
            onAddModel,
          },
        }),
      ),
    ),
  );

  await user.click(screen.getByRole("button", { name: "选择模型" }));
  expect(screen.getByText("还没有添加模型")).toBeVisible();
  await user.click(screen.getByRole("menuitem", { name: "添加模型" }));
  expect(onAddModel).toHaveBeenCalledTimes(1);
});
