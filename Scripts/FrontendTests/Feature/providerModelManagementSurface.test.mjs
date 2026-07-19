import React from "react";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { ProviderModelManagementSurface } from "../../../Frontend/src/features/settings/sections/ProviderModelManagementSurface.tsx";
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
  await user.click(screen.getByRole("button", { name: "关闭窗口" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
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
