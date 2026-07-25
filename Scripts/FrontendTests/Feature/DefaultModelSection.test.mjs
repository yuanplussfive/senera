import React from "react";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DefaultModelSection } from "../../../Frontend/src/features/settings/sections/DefaultModelSection.tsx";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

afterEach(() => cleanup());

describe("DefaultModelSection", () => {
  it("routes role selections through capability-filtered model menus", async () => {
    const updateDraft = vi.fn();
    const setDefaultProviderModel = vi.fn(() => "default-command");
    const draftState = createDraftState(updateDraft);
    const user = userEvent.setup();
    renderWithFrontendProviders(
      React.createElement(DefaultModelSection, {
        draftState,
        systemConfig: createSystemConfig(setDefaultProviderModel),
      }),
    );

    expect(screen.getByText("模型职责")).toBeVisible();
    expect(screen.getAllByText("必填")).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: /默认模型: Chat Alpha/ }));
    expect(screen.queryByRole("menuitem", { name: /embedding-alpha/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: /Chat Beta/ }));
    expect(setDefaultProviderModel).toHaveBeenCalledWith("chat-b");

    await user.click(screen.getByRole("button", { name: /Planner 模型: Chat Alpha/ }));
    expect(screen.queryByRole("menuitem", { name: /embedding-alpha/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: /Chat Beta/ }));
    expect(updateDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        ActionPlanner: { Client: { ModelProviderId: "chat-b" } },
      }),
      "immediate",
    );

    await user.click(screen.getByRole("button", { name: /嵌入模型: embedding-alpha/ }));
    expect(screen.queryByRole("menuitem", { name: /Chat Alpha/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: /embedding-beta/ }));
    expect(updateDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({
        VectorModels: {
          Embedding: {
            ProviderId: "provider-b",
            Model: "embedding-beta",
          },
        },
      }),
      "immediate",
    );
  });
});

function createDraftState(updateDraft) {
  return {
    draft: {
      DefaultModelProviderId: "chat-a",
      ModelProviderEndpoints: [
        { Id: "provider-a", Enabled: true },
        { Id: "provider-b", Enabled: true },
      ],
      ModelProviders: [
        createModel("chat-a", "provider-a", "Chat Alpha", { Chat: true }),
        createModel("chat-b", "provider-b", "Chat Beta", { Chat: true }),
        createModel("embedding-a", "provider-a", "embedding-alpha", { Chat: false, Embedding: true }),
        createModel("embedding-b", "provider-b", "embedding-beta", { Chat: false, Embedding: true }),
      ],
      VectorModels: { Embedding: { ProviderId: "provider-a", Model: "embedding-alpha" } },
    },
    diagnostics: [],
    dirty: false,
    localError: null,
    saving: false,
    savedRecently: false,
    conflict: false,
    validationErrors: [],
    flushSave: vi.fn(),
    refreshOrRestore: vi.fn(),
    save: vi.fn(),
    updateDraft,
  };
}

function createSystemConfig(setDefaultProviderModel) {
  const draft = createDraftState(vi.fn()).draft;
  return {
    configSnapshot: {
      path: "test",
      version: 1,
      revision: 1,
      value: draft,
      source: "sqlite",
      diagnostics: [],
      form: {
        version: 1,
        sections: [
          createSection("models", [
            createField(["DefaultModelProviderId"], "默认模型", {
              id: "assistant",
              capability: "Chat",
              valueKind: "model-id",
              mutation: "default-model",
              required: true,
            }),
            createField(["ModelProviderEndpoints"], "供应商端点", undefined, draft.ModelProviderEndpoints),
            {
              ...createField(["ModelProviders"], "模型列表", undefined, draft.ModelProviders),
              defaultItem: {
                Capabilities: { Chat: true, Embedding: false, Rerank: false },
              },
            },
          ]),
          createSection("planning", [
            createField(["ActionPlanner", "Client", "ModelProviderId"], "Planner 模型", {
              id: "planner",
              capability: "Chat",
              valueKind: "model-id",
              mutation: "config",
              required: true,
            }),
          ]),
          createSection("retrieval", [
            createField(["VectorModels", "Embedding", "ProviderId"], "嵌入供应商", undefined, "provider-a"),
            createField(
              ["VectorModels", "Embedding", "Model"],
              "嵌入模型",
              {
                id: "embedding",
                capability: "Embedding",
                valueKind: "provider-model",
                mutation: "config",
                providerPath: ["VectorModels", "Embedding", "ProviderId"],
                required: true,
              },
              "embedding-alpha",
            ),
          ]),
        ],
      },
    },
    providerModelCatalogs: {},
    providerModelErrors: {},
    providerModelLoadingIds: {},
    providerModelOperations: {},
    setDefaultProviderModel,
  };
}

function createSection(name, fields) {
  return { name, label: name, keyCount: fields.length, fields };
}

function createField(path, label, modelSelection, effectiveValue) {
  return {
    label,
    section:
      path[0] === "DefaultModelProviderId" || path.length === 1
        ? "models"
        : path[0] === "ActionPlanner"
          ? "planning"
          : "retrieval",
    key: path.at(-1),
    path,
    type: path.length === 1 && path[0] !== "DefaultModelProviderId" ? "array" : "string",
    value: undefined,
    effectiveValue,
    configured: false,
    missing: effectiveValue === undefined,
    valueSource: effectiveValue === undefined ? "missing" : "default",
    required: false,
    essential: false,
    ...(modelSelection ? { modelSelection } : {}),
  };
}

function createModel(Id, ProviderId, Model, Capabilities) {
  return { Id, ProviderId, Model, Endpoint: "ChatCompletions", Capabilities };
}
