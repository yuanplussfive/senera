import React, { useState } from "react";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

vi.mock("../../../Frontend/src/shared/ui/Tooltip.tsx", () => ({
  TooltipProvider: ({ children }) => React.createElement(React.Fragment, null, children),
  Tooltip: ({ children }) => React.createElement(React.Fragment, null, children),
}));

const { ModelConfigView } = await import("../../../Frontend/src/features/chat/ModelConfigView.tsx");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("model config adds a provider through the controlled value contract", async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  renderWithFrontendProviders(
    React.createElement(ModelConfigHarness, {
      initialValue: { ModelProviderEndpoints: [], ModelProviders: [] },
      onChange,
    }),
  );

  await user.click(screen.getByRole("button", { name: "添加供应商" }));

  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      ModelProviderEndpoints: [expect.objectContaining({ Id: "provider", Enabled: true })],
      ModelProviders: [],
    }),
  );
  expect(screen.getByRole("dialog", { name: "供应商设置" })).toBeInTheDocument();
  expect(screen.getByPlaceholderText("唯一供应商名称")).toHaveValue("provider");
});

test("removing a provider also removes its models and repairs the default model", async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  renderWithFrontendProviders(
    React.createElement(ModelConfigHarness, {
      initialValue: {
        ModelProviderEndpoints: [provider("provider-a"), provider("provider-b")],
        ModelProviders: [model("model-a", "provider-a"), model("model-b", "provider-b")],
        DefaultModelProviderId: "model-a",
      },
      onChange,
    }),
  );

  await user.click(screen.getByRole("button", { name: "删除供应商" }));

  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      ModelProviderEndpoints: [expect.objectContaining({ Id: "provider-b" })],
      ModelProviders: [expect.objectContaining({ Id: "model-b", ProviderId: "provider-b" })],
      DefaultModelProviderId: "model-b",
    }),
  );
  expect(screen.queryByText("provider-a")).not.toBeInTheDocument();
});

test("provider discovery forwards the normalized endpoint without leaking empty headers", async () => {
  const onFetchProviderModels = vi.fn();
  const user = userEvent.setup();
  renderWithFrontendProviders(
    React.createElement(
      ModelConfigView,
      createProps({
        value: {
          ModelProviderEndpoints: [
            provider("provider-a", {
              BaseUrl: "https://model.example/v1",
              ApiKey: "test-key",
              Headers: { Authorization: "Bearer token", "": "ignored" },
            }),
          ],
          ModelProviders: [],
        },
        onFetchProviderModels,
      }),
    ),
  );

  await user.click(screen.getByRole("button", { name: "获取模型列表" }));

  expect(onFetchProviderModels).toHaveBeenCalledWith("provider-a", true, {
    Id: "provider-a",
    Enabled: true,
    Kind: "OpenAICompatible",
    BaseUrl: "https://model.example/v1",
    ApiKey: "test-key",
    Headers: { Authorization: "Bearer token" },
  });
});

test("catalog model configuration saves a new default model", async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  renderWithFrontendProviders(
    React.createElement(ModelConfigHarness, {
      initialValue: {
        ModelProviderEndpoints: [provider("provider-a")],
        ModelProviders: [],
      },
      catalogs: {
        "provider-a": {
          providerId: "provider-a",
          baseUrl: "https://model.example/v1",
          fetchedAt: "2026-01-01T00:00:00.000Z",
          source: "network",
          models: [{ id: "model-latest", ownedBy: "provider-a" }],
        },
      },
      onChange,
    }),
  );

  await user.click(screen.getByRole("button", { name: "配置模型" }));
  await user.click(screen.getByRole("button", { name: "添加到草稿" }));

  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      DefaultModelProviderId: "provider-a/model-latest",
      ModelProviders: [
        expect.objectContaining({
          Id: "provider-a/model-latest",
          ProviderId: "provider-a",
          Endpoint: "ChatCompletions",
          Model: "model-latest",
        }),
      ],
    }),
  );
});

function ModelConfigHarness({ initialValue, catalogs = {}, onChange }) {
  const [value, setValue] = useState(initialValue);
  return React.createElement(
    ModelConfigView,
    createProps({
      value,
      catalogs,
      onChange: (next) => {
        setValue(next);
        onChange(next);
      },
    }),
  );
}

function createProps(overrides = {}) {
  return {
    value: {},
    section: modelSection,
    catalogs: {},
    errors: {},
    loadingProviderIds: {},
    onFetchProviderModels: vi.fn(),
    onChange: vi.fn(),
    ...overrides,
  };
}

function provider(Id, overrides = {}) {
  return {
    Id,
    Enabled: true,
    Kind: "OpenAICompatible",
    BaseUrl: "https://model.example/v1",
    ...overrides,
  };
}

function model(Id, ProviderId) {
  return {
    Id,
    ProviderId,
    Endpoint: "ChatCompletions",
    Model: Id,
  };
}

const modelSection = {
  name: "models",
  label: "Models",
  keyCount: 4,
  fields: [
    {
      section: "models",
      key: "ModelProviderEndpoints",
      path: ["ModelProviderEndpoints"],
      label: "Providers",
      type: "array",
      itemType: "table",
      value: [],
      effectiveValue: [],
      configured: true,
      defaultItem: {
        Enabled: true,
        Kind: "OpenAICompatible",
        BaseUrl: "https://model.example/v1",
      },
    },
    {
      section: "models",
      key: "ModelProviders",
      path: ["ModelProviders"],
      label: "Models",
      type: "array",
      itemType: "table",
      value: [],
      effectiveValue: [],
      configured: true,
      defaultItem: {
        Endpoint: "ChatCompletions",
        Stream: true,
      },
      itemFields: [
        {
          section: "models",
          key: "Endpoint",
          path: ["ModelProviders", "Endpoint"],
          label: "Endpoint",
          type: "string",
          value: "ChatCompletions",
          effectiveValue: "ChatCompletions",
          configured: true,
          options: ["ChatCompletions", "Responses"],
        },
      ],
    },
    {
      section: "models",
      key: "ModelGroups",
      path: ["ModelGroups"],
      label: "Groups",
      type: "array",
      itemType: "table",
      value: [],
      effectiveValue: [],
      configured: false,
    },
    {
      section: "models",
      key: "DefaultModelProviderId",
      path: ["DefaultModelProviderId"],
      label: "Default model",
      type: "string",
      value: "",
      effectiveValue: "",
      configured: false,
    },
  ],
};
