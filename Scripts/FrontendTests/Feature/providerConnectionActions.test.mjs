import React, { useEffect, useState } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useProviderConnectionActions } from "../../../Frontend/src/features/settings/sections/useProviderConnectionActions.ts";
import { ConfigSecretContract } from "../../../Frontend/src/api/generatedEventCatalog.ts";

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
            commandId: "rename-request",
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
            commandId: "add-request",
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

  await act(async () => {
    view.rerender(
      React.createElement(ActionsHarness, {
        handleRef,
        onUpsertProviderEndpoint,
        operations: {
          beta: {
            commandId: "add-request",
            kind: "provider.endpoint.upsert",
            status: "success",
            updatedAt: "2026-07-12T00:00:00.000Z",
          },
        },
        state: createState("alpha"),
      }),
    );
  });

  expect(handleRef.current.selectedProviderId).toBe("alpha");
  expect(handleRef.current.actions.connectionDraft?.Id).toBe("alpha");
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
            commandId: "save-request",
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
            commandId: "first-save",
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
            commandId: "save-request",
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
            commandId: "alpha-save",
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

test("invalid drafts cannot be silently discarded when switching before blur", async () => {
  const handleRef = { current: null };
  render(React.createElement(ActionsHarness, { handleRef, state: createMultiState() }));
  const beta = createMultiState().providers[1];

  await act(async () => {
    handleRef.current.actions.updateDraftProvider({ BaseUrl: "not-a-url" });
    expect(handleRef.current.actions.commitAndSelectProvider(beta)).toBe(false);
  });

  expect(handleRef.current.selectedProviderId).toBe("alpha");
  expect(handleRef.current.actions.localError).toBe("API 地址必须是以 http:// 或 https:// 开头的完整 URL。");
  expect(handleRef.current.actions.connectionDraft?.BaseUrl).toBe("not-a-url");
});

test("redacted snapshots settle secret saves and allow a clean provider switch", async () => {
  const handleRef = { current: null };
  const onUpsertProviderEndpoint = vi.fn(() => "secret-save");
  const redacted = ConfigSecretContract.RedactedPlaceholder;
  const alpha = {
    Id: "alpha",
    Enabled: true,
    BaseUrl: "https://alpha.example.test/v1",
    ApiKey: redacted,
    Headers: { Authorization: redacted, "X-Trace": "trace" },
  };
  const beta = createState("beta").providers[0];
  const initialState = {
    ...createMultiState(),
    providers: [alpha, beta],
    selectedProvider: alpha,
  };
  const view = render(
    React.createElement(ActionsHarness, {
      handleRef,
      onUpsertProviderEndpoint,
      state: initialState,
    }),
  );

  await act(async () => {
    handleRef.current.actions.updateDraftProvider({
      ApiKey: "rotated-secret",
      Headers: { "X-Trace": "trace", Authorization: "Bearer rotated" },
    });
    handleRef.current.actions.confirmDraft();
  });
  expect(handleRef.current.actions.dirty).toBe(true);

  await act(async () => {
    view.rerender(
      React.createElement(ActionsHarness, {
        handleRef,
        onUpsertProviderEndpoint,
        operations: {
          alpha: {
            commandId: "secret-save",
            kind: "provider.endpoint.upsert",
            status: "success",
            updatedAt: "2026-07-27T00:00:00.000Z",
          },
        },
        state: initialState,
      }),
    );
  });

  expect(handleRef.current.actions.dirty).toBe(false);
  expect(handleRef.current.actions.connectionDraft?.ApiKey).toBe(redacted);
  expect(handleRef.current.actions.commitAndSelectProvider(beta)).toBe(true);
});

test("selecting the active provider never asks callers to discard its blocked draft", async () => {
  const handleRef = { current: null };
  render(React.createElement(ActionsHarness, { handleRef, state: createState("alpha"), socketStatus: "idle" }));

  await act(async () => {
    handleRef.current.actions.updateDraftProvider({ ApiKey: "local-only" });
    handleRef.current.actions.confirmDraft();
  });

  expect(handleRef.current.actions.dirty).toBe(true);
  expect(handleRef.current.actions.localError).toBe("配置服务连接已中断，当前修改仍保留在本地草稿中。");
  expect(handleRef.current.actions.commitAndSelectProvider(createState("alpha").providers[0])).toBe(true);
});

function ActionsHarness({
  handleRef,
  onRender,
  onDeleteProviderEndpoint = () => "delete-request",
  onRenameProviderEndpoint = () => "rename-request",
  onUpsertProviderEndpoint = () => "upsert-request",
  operations = {},
  socketStatus = "open",
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
    socketStatus,
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
