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

  const view = render(
    React.createElement(ActionsHarness, {
      handleRef,
      onRender: () => {
        renderCount += 1;
      },
      state,
    }),
  );

  await act(async () => {
    view.rerender(
      React.createElement(ActionsHarness, {
        handleRef,
        onRender: () => {
          renderCount += 1;
        },
        state: createState("alpha"),
      }),
    );
  });

  expect(handleRef.current.selectedProviderId).toBe("alpha");
  expect(handleRef.current.actions.connectionDraft?.Id).toBe("alpha");
  expect(renderCount).toBeLessThan(5);
});

test("selected provider changes to the renamed ID only after its snapshot arrives", async () => {
  const handleRef = { current: null };
  const onRenameProviderEndpoint = vi.fn(() => "rename-request");
  const view = render(
    React.createElement(ActionsHarness, {
      handleRef,
      onRenameProviderEndpoint,
      state: createState("alpha"),
    }),
  );

  await act(async () => {
    handleRef.current.actions.renameProvider("alpha", "beta");
  });

  expect(onRenameProviderEndpoint).toHaveBeenCalledWith("alpha", "beta");
  expect(handleRef.current.selectedProviderId).toBe("alpha");
  expect(handleRef.current.actions.connectionDraft?.Id).toBe("alpha");

  await act(async () => {
    view.rerender(
      React.createElement(ActionsHarness, {
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
      }),
    );
  });

  expect(handleRef.current.selectedProviderId).toBe("beta");
  expect(handleRef.current.actions.connectionDraft?.Id).toBe("beta");
});

test("provider deletion forwards the lifecycle dialog's explicit cascade and replacement choice", async () => {
  const handleRef = { current: null };
  const onDeleteProviderEndpoint = vi.fn(() => "delete-request");
  render(
    React.createElement(ActionsHarness, {
      handleRef,
      onDeleteProviderEndpoint,
      state: createState("alpha"),
    }),
  );

  let accepted = false;
  await act(async () => {
    accepted = handleRef.current.actions.deleteProvider(
      { Id: "alpha", Enabled: true, BaseUrl: "https://alpha.example.test/v1" },
      { cascadeModels: true, replacementDefaultModelId: "beta:model" },
    );
  });

  expect(accepted).toBe(true);
  expect(onDeleteProviderEndpoint).toHaveBeenCalledWith("alpha", {
    cascadeModels: true,
    replacementDefaultModelId: "beta:model",
  });
});

test("new provider presets remain editable after the identity snapshot arrives", async () => {
  const handleRef = { current: null };
  const onUpsertProviderEndpoint = vi.fn(() => "add-request");
  const view = render(
    React.createElement(ActionsHarness, {
      handleRef,
      onUpsertProviderEndpoint,
      state: createState("alpha"),
    }),
  );

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
    view.rerender(
      React.createElement(ActionsHarness, {
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
      }),
    );
  });

  expect(handleRef.current.selectedProviderId).toBe("beta");
  expect(handleRef.current.actions.connectionDraft?.BaseUrl).toBe("https://preset.example.test/v1");
});

test("provider connection commits the latest draft and immediate patches", async () => {
  const handleRef = { current: null };
  const onUpsertProviderEndpoint = vi.fn(() => "save-request");
  const view = render(
    React.createElement(ActionsHarness, {
      handleRef,
      onUpsertProviderEndpoint,
      state: createState("alpha"),
    }),
  );

  await act(async () => {
    handleRef.current.actions.updateDraftProvider({ ApiKey: "secret" });
  });
  await act(async () => {
    handleRef.current.actions.confirmDraft();
  });
  expect(onUpsertProviderEndpoint).toHaveBeenLastCalledWith(expect.objectContaining({ Id: "alpha", ApiKey: "secret" }));

  await act(async () => {
    view.rerender(
      React.createElement(ActionsHarness, {
        handleRef,
        onUpsertProviderEndpoint,
        operations: {
          alpha: {
            requestId: "save-request",
            kind: "provider.endpoint.upsert",
            status: "success",
            updatedAt: "2026-07-12T00:00:00.000Z",
          },
        },
        state: createState("alpha"),
      }),
    );
  });
  await act(async () => {
    handleRef.current.actions.confirmDraft({ Enabled: false });
  });
  expect(onUpsertProviderEndpoint).toHaveBeenLastCalledWith(expect.objectContaining({ Id: "alpha", Enabled: false }));
});

test("provider connection sends the newest draft after an in-flight save completes", async () => {
  const handleRef = { current: null };
  const onUpsertProviderEndpoint = vi.fn().mockReturnValueOnce("first-save").mockReturnValueOnce("second-save");
  const view = render(
    React.createElement(ActionsHarness, {
      handleRef,
      onUpsertProviderEndpoint,
      state: createState("alpha"),
    }),
  );

  await act(async () => {
    handleRef.current.actions.confirmDraft({ ApiKey: "first" });
    handleRef.current.actions.confirmDraft({ ApiKey: "latest" });
  });
  expect(onUpsertProviderEndpoint).toHaveBeenCalledTimes(1);

  await act(async () => {
    view.rerender(
      React.createElement(ActionsHarness, {
        handleRef,
        onUpsertProviderEndpoint,
        operations: {
          alpha: {
            requestId: "first-save",
            kind: "provider.endpoint.upsert",
            status: "success",
            updatedAt: "2026-07-12T00:00:00.000Z",
          },
        },
        state: {
          ...createState("alpha"),
          providers: [{ ...createState("alpha").providers[0], ApiKey: "first" }],
        },
      }),
    );
  });

  expect(onUpsertProviderEndpoint).toHaveBeenCalledTimes(2);
  expect(onUpsertProviderEndpoint).toHaveBeenLastCalledWith(expect.objectContaining({ Id: "alpha", ApiKey: "latest" }));
});

test("provider reset follows the saved snapshot when the response arrives", async () => {
  const handleRef = { current: null };
  const onUpsertProviderEndpoint = vi.fn(() => "save-request");
  const view = render(
    React.createElement(ActionsHarness, {
      handleRef,
      onUpsertProviderEndpoint,
      state: createState("alpha"),
    }),
  );

  await act(async () => {
    handleRef.current.actions.confirmDraft({ ApiKey: "secret" });
    handleRef.current.actions.resetDraft();
  });

  expect(handleRef.current.actions.connectionDraft?.ApiKey).toBeUndefined();

  await act(async () => {
    view.rerender(
      React.createElement(ActionsHarness, {
        handleRef,
        onUpsertProviderEndpoint,
        operations: {
          alpha: {
            requestId: "save-request",
            kind: "provider.endpoint.upsert",
            status: "success",
            updatedAt: "2026-07-12T00:00:00.000Z",
          },
        },
        state: {
          ...createState("alpha"),
          providers: [{ ...createState("alpha").providers[0], ApiKey: "secret" }],
        },
      }),
    );
  });

  expect(handleRef.current.actions.connectionDraft?.ApiKey).toBe("secret");
  expect(handleRef.current.actions.dirty).toBe(false);
});

test("provider drafts and errors stay isolated when switching during a save", async () => {
  const handleRef = { current: null };
  const onUpsertProviderEndpoint = vi.fn(() => "alpha-save");
  const view = render(
    React.createElement(ActionsHarness, {
      handleRef,
      onUpsertProviderEndpoint,
      state: createMultiState(),
    }),
  );
  const beta = createMultiState().providers[1];

  await act(async () => {
    handleRef.current.actions.updateDraftProvider({ ApiKey: "alpha-secret" });
    handleRef.current.actions.confirmDraft();
    handleRef.current.actions.commitAndSelectProvider(beta);
  });

  expect(handleRef.current.selectedProviderId).toBe("beta");
  expect(handleRef.current.actions.connectionDraft?.ApiKey).toBeUndefined();

  await act(async () => {
    view.rerender(
      React.createElement(ActionsHarness, {
        handleRef,
        onUpsertProviderEndpoint,
        operations: {
          alpha: {
            requestId: "alpha-save",
            kind: "provider.endpoint.upsert",
            status: "error",
            message: "alpha rejected",
            updatedAt: "2026-07-12T00:00:00.000Z",
          },
        },
        state: createMultiState(),
      }),
    );
  });

  expect(handleRef.current.selectedProviderId).toBe("beta");
  expect(handleRef.current.actions.localError).toBeNull();

  await act(async () => {
    handleRef.current.actions.commitAndSelectProvider(createMultiState().providers[0]);
  });

  expect(handleRef.current.actions.connectionDraft?.ApiKey).toBe("alpha-secret");
  expect(handleRef.current.actions.localError).toBe("alpha rejected");
});

function ActionsHarness({
  handleRef,
  onRender,
  onDeleteProviderEndpoint = () => "delete-request",
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
    onDeleteProviderEndpoint,
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

function createMultiState() {
  const alpha = createState("alpha").providers[0];
  const beta = createState("beta").providers[0];
  return {
    ...createState("alpha"),
    providers: [alpha, beta],
    selectedProvider: alpha,
    providerCount: 2,
    enabledProviders: 2,
  };
}
