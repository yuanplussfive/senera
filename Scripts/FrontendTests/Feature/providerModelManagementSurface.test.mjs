import React from "react";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { ProviderModelManagementSurface } from "../../../Frontend/src/features/settings/sections/ProviderModelManagementSurface.tsx";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";
import { TooltipProvider } from "../../../Frontend/src/shared/ui/index.ts";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("model editor stays open after a failed save so the draft can be retried", async () => {
  const user = userEvent.setup();
  const model = {
    Id: "openai/gpt-4.1",
    ProviderId: "openai",
    Model: "gpt-4.1",
    Endpoint: "chat",
    Capabilities: { Chat: true },
  };
  const onUpsertProviderModel = vi.fn(() => "model-save");
  const operations = {};
  const props = createProps({ model, onUpsertProviderModel, operations });
  renderWithFrontendProviders(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(ProviderModelManagementSurface, props),
    ),
  );

  await user.click(screen.getByRole("button", { name: "配置" }));
  await user.click(screen.getByRole("button", { name: "对话" }));
  await waitFor(() => expect(onUpsertProviderModel).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("dialog")).toBeInTheDocument();

  operations[model.Id] = {
    requestId: "model-save",
    kind: "provider.model.upsert",
    status: "error",
    message: "model rejected",
    updatedAt: "2026-07-12T00:00:00.000Z",
  };
  await user.click(screen.getByRole("button", { name: "对话" }));

  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /重试|Retry/ })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "关闭" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

test("model tool planning defaults to native and keeps native prerequisites consistent", async () => {
  const user = userEvent.setup();
  const model = {
    Id: "openai/gpt-4.1",
    ProviderId: "openai",
    Model: "gpt-4.1",
    Endpoint: "chat",
    Capabilities: { Chat: true },
  };
  const props = createProps({ model, onUpsertProviderModel: vi.fn() });
  renderWithFrontendProviders(React.createElement(ProviderModelManagementSurface, props));

  await user.click(screen.getByRole("button", { name: frontendMessage("chat.model.configure") }));
  const dialog = screen.getByRole("dialog");
  const nativeMode = within(dialog).getByRole("radio", {
    name: frontendMessage("config.model.toolPlanning.native"),
  });
  const bamlMode = within(dialog).getByRole("radio", {
    name: frontendMessage("config.model.toolPlanning.baml"),
  });
  const toolCalling = within(dialog).getByRole("button", {
    name: frontendMessage("config.model.capability.toolCalling"),
  });
  const streaming = within(dialog).getByRole("switch", {
    name: frontendMessage("config.model.streaming"),
  });

  expect(nativeMode).toHaveAttribute("aria-checked", "true");
  expect(toolCalling).toHaveAttribute("aria-pressed", "true");
  expect(streaming).toHaveAttribute("aria-checked", "true");

  await user.click(toolCalling);
  expect(bamlMode).toHaveAttribute("aria-checked", "true");
  expect(toolCalling).toHaveAttribute("aria-pressed", "false");

  await user.click(nativeMode);
  expect(nativeMode).toHaveAttribute("aria-checked", "true");
  expect(toolCalling).toHaveAttribute("aria-pressed", "true");
  expect(streaming).toHaveAttribute("aria-checked", "true");

  await user.click(streaming);
  expect(bamlMode).toHaveAttribute("aria-checked", "true");
  expect(streaming).toHaveAttribute("aria-checked", "false");
});

test("model discovery supports enabled public endpoints without an API key", async () => {
  const user = userEvent.setup();
  const model = {
    Id: "openai/gpt-4.1",
    ProviderId: "openai",
    Model: "gpt-4.1",
    Endpoint: "chat",
    Capabilities: { Chat: true },
  };
  const props = createProps({ model, onUpsertProviderModel: vi.fn() });
  props.showFetchAction = true;

  renderWithFrontendProviders(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(ProviderModelManagementSurface, props),
    ),
  );

  await user.click(screen.getByRole("button", { name: "获取模型列表" }));
  expect(props.onFetchProviderModels).toHaveBeenCalledWith(
    "openai",
    true,
    expect.objectContaining({ Id: "openai", Enabled: true }),
  );
});

test("remote catalog models appear only in the fetch dialog until they are added", async () => {
  const user = userEvent.setup();
  const model = {
    Id: "openai/gpt-4.1",
    ProviderId: "openai",
    Model: "gpt-4.1",
    Endpoint: "chat",
    Capabilities: { Chat: true },
  };
  const onUpsertProviderModel = vi.fn();
  const props = createProps({ model, onUpsertProviderModel });
  props.state.providers[0].ApiKey = "secret";
  props.catalogs.openai.models.push({ id: "gpt-4.1-mini", ownedBy: "openai" });
  props.showFetchAction = true;

  renderWithFrontendProviders(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(ProviderModelManagementSurface, props),
    ),
  );

  expect(screen.queryByText("gpt-4.1-mini")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "获取模型列表" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("gpt-4.1-mini")).toBeInTheDocument();

  await user.click(within(dialog).getByRole("button", { name: "添加模型 gpt-4.1-mini" }));
  expect(onUpsertProviderModel).toHaveBeenCalledWith(
    expect.objectContaining({
      model: expect.objectContaining({ ProviderId: "openai", Model: "gpt-4.1-mini" }),
    }),
  );
});

test("embedded model management scrolls only the model rows", () => {
  const model = {
    Id: "openai/gpt-4.1",
    ProviderId: "openai",
    Model: "gpt-4.1",
    Endpoint: "chat",
    Capabilities: { Chat: true },
  };
  const props = createProps({ model, onUpsertProviderModel: vi.fn() });
  props.embedded = true;
  props.showFetchAction = true;
  props.state.providers[0].ApiKey = "secret";

  renderWithFrontendProviders(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(ProviderModelManagementSurface, props),
    ),
  );

  const modelRow = screen.getByText("gpt-4.1");
  const viewport = modelRow.closest("[data-radix-scroll-area-viewport]");
  const fetchButton = screen.getByRole("button", { name: "获取模型列表" });

  expect(viewport).not.toBeNull();
  expect(viewport).toContainElement(modelRow);
  expect(viewport).not.toContainElement(fetchButton);
});

test("embedded model search exposes its disclosure state and clears a hidden query", async () => {
  const user = userEvent.setup();
  const model = {
    Id: "openai/gpt-4.1",
    ProviderId: "openai",
    Model: "gpt-4.1",
    Endpoint: "chat",
    Capabilities: { Chat: true },
  };
  const props = createProps({ model, onUpsertProviderModel: vi.fn() });
  props.embedded = true;

  renderWithFrontendProviders(React.createElement(ProviderModelManagementSurface, props));

  const openSearch = screen.getByRole("button", { name: frontendMessage("config.model.searchPlaceholder") });
  expect(openSearch).toHaveAttribute("aria-expanded", "false");

  await user.click(openSearch);

  const closeSearch = screen.getByRole("button", { name: frontendMessage("config.model.closeSearch") });
  const searchInput = screen.getByRole("textbox", { name: frontendMessage("config.model.searchPlaceholder") });
  const disclosureId = closeSearch.getAttribute("aria-controls");
  expect(closeSearch).toHaveAttribute("aria-expanded", "true");
  expect(disclosureId).not.toBeNull();
  expect(document.getElementById(disclosureId)).toContainElement(searchInput);

  await user.type(searchInput, "mini");
  expect(searchInput).toHaveValue("mini");
  await user.click(closeSearch);

  await waitFor(() =>
    expect(
      screen.queryByRole("textbox", { name: frontendMessage("config.model.searchPlaceholder") }),
    ).not.toBeInTheDocument(),
  );
  await user.click(screen.getByRole("button", { name: frontendMessage("config.model.searchPlaceholder") }));
  expect(screen.getByRole("textbox", { name: frontendMessage("config.model.searchPlaceholder") })).toHaveValue("");
});

function createProps({ model, onUpsertProviderModel, operations = {} }) {
  const provider = { Id: "openai", Enabled: true };
  return {
    disabled: false,
    endpointOptions: [{ value: "chat", label: "Chat" }],
    modelField: undefined,
    onFetchProviderModels: vi.fn(),
    onRequestRemoveModel: vi.fn(),
    onSetDefaultModel: vi.fn(),
    onUpsertProviderModel,
    operations,
    state: {
      providers: [provider],
      models: [model],
      defaultModel: { model },
      selectedProvider: provider,
      selectedProviderModelList: null,
      defaultModelStatus: "可用",
      defaultSlots: [],
      diagnostics: [],
      catalogSignalCount: 0,
      enabledModelCount: 1,
      enabledProviders: 1,
      providerCount: 1,
      providerIssues: [],
    },
    catalogs: {
      openai: {
        providerId: "openai",
        baseUrl: "https://api.openai.com/v1",
        fetchedAt: "2026-07-12T00:00:00.000Z",
        source: "network",
        models: [{ id: "gpt-4.1", ownedBy: "openai" }],
      },
    },
    errors: {},
    loadingProviderIds: {},
    draft: {},
    section: { name: "models", label: "模型", keyCount: 0, fields: [] },
    showProviderList: false,
    showFetchAction: false,
  };
}
