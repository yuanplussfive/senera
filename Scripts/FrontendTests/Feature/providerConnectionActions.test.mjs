import React, { useEffect, useState } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useProviderConnectionActions } from "../../../Frontend/src/features/settings/sections/useProviderConnectionActions.ts";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("connection actions do not reset a draft when provider objects are rematerialized", async () => {
  const handleRef = { current: null };
  let renderCount = 0;
  const state = createState("alpha");

  const view = render(React.createElement(ActionsHarness, {
    handleRef,
    onRender: () => {
      renderCount += 1;
    },
    state,
  }));

  await act(async () => {
    view.rerender(React.createElement(ActionsHarness, {
      handleRef,
      onRender: () => {
        renderCount += 1;
      },
      state: createState("alpha"),
    }));
  });

  expect(handleRef.current.selectedProviderId).toBe("alpha");
  expect(handleRef.current.actions.connectionDraft?.Id).toBe("alpha");
  expect(renderCount).toBeLessThan(5);
});

test("selected provider changes to the renamed ID only after its snapshot arrives", async () => {
  const handleRef = { current: null };
  const onRenameProviderEndpoint = vi.fn(() => "rename-request");
  const view = render(React.createElement(ActionsHarness, {
    handleRef,
    onRenameProviderEndpoint,
    state: createState("alpha"),
  }));

  await act(async () => {
    handleRef.current.actions.renameProvider("alpha", "beta");
  });

  expect(onRenameProviderEndpoint).toHaveBeenCalledWith("alpha", "beta");
  expect(handleRef.current.selectedProviderId).toBe("alpha");
  expect(handleRef.current.actions.connectionDraft?.Id).toBe("alpha");

  await act(async () => {
    view.rerender(React.createElement(ActionsHarness, {
      handleRef,
      onRenameProviderEndpoint,
      operations: {
        alpha: {
          requestId: "rename-request",
          kind: "provider.endpoint.rename",
          status: "success",
          updatedAt: "2026-07-12T00:00:00.000Z",
        },
      },
      state: createState("beta"),
    }));
  });

  expect(handleRef.current.selectedProviderId).toBe("beta");
  expect(handleRef.current.actions.connectionDraft?.Id).toBe("beta");
});

test("new provider presets remain editable after the identity snapshot arrives", async () => {
  const handleRef = { current: null };
  const onUpsertProviderEndpoint = vi.fn(() => "add-request");
  const view = render(React.createElement(ActionsHarness, {
    handleRef,
    onUpsertProviderEndpoint,
    state: createState("alpha"),
  }));

  await act(async () => {
    handleRef.current.actions.addProvider({
      Id: "beta",
      Enabled: true,
      Kind: "OpenAICompatible",
      BaseUrl: "https://preset.example.test/v1",
      ApiKey: "",
      ApiVersion: "2023-06-01",
      Headers: {},
    });
  });

  await act(async () => {
    view.rerender(React.createElement(ActionsHarness, {
      handleRef,
      onUpsertProviderEndpoint,
      operations: {
        beta: {
          requestId: "add-request",
          kind: "provider.endpoint.upsert",
          status: "success",
          updatedAt: "2026-07-12T00:00:00.000Z",
        },
      },
      state: createState("beta", ""),
    }));
  });

  expect(handleRef.current.selectedProviderId).toBe("beta");
  expect(handleRef.current.actions.connectionDraft?.BaseUrl).toBe("https://preset.example.test/v1");
});

function ActionsHarness({
  handleRef,
  onRender,
  onRenameProviderEndpoint = () => "rename-request",
  onUpsertProviderEndpoint = () => "upsert-request",
  operations = {},
  state,
}) {
  const [selectedProviderId, setSelectedProviderId] = useState("alpha");
  const rematerializedState = {
    ...state,
    providers: state.providers.map((provider) => ({ ...provider })),
    models: state.models.map((model) => ({ ...model })),
  };
  const actions = useProviderConnectionActions({
    state: rematerializedState,
    catalogs: {},
    errors: {},
    loadingProviderIds: {},
    operations,
    selectedProviderId,
    setSelectedProviderId,
    onDeleteProviderEndpoint: () => "delete-request",
    onFetchProviderModels: () => undefined,
    onRenameProviderEndpoint,
    onUpsertProviderEndpoint,
  });

  onRender?.();
  useEffect(() => {
    handleRef.current = { actions, selectedProviderId };
  });

  return React.createElement("div", null, actions.connectionDraft?.Id ?? "none");
}

function createState(providerId, baseUrl = `https://${providerId}.example.test/v1`) {
  const provider = {
    Id: providerId,
    Enabled: true,
    BaseUrl: baseUrl,
  };
  return {
    providers: [provider],
    models: [],
    selectedProvider: provider,
    selectedProviderModelList: null,
    defaultModel: null,
    defaultModelStatus: "待设置",
    defaultSlots: [],
    diagnostics: [],
    catalogSignalCount: 0,
    enabledModelCount: 0,
    enabledProviders: 1,
    providerCount: 1,
    providerIssues: [],
  };
}
