import React from "react";
import { cleanup, screen, within } from "@testing-library/react";
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
    const { container } = renderWithFrontendProviders(
      React.createElement(DefaultModelSection, {
        draftState,
        systemConfig: createSystemConfig(setDefaultProviderModel),
      }),
    );

    expect(screen.getByText("模型职责")).toBeVisible();
    expect(screen.getAllByText("必填")).toHaveLength(3);
    expect(container.querySelectorAll("[data-model-assignment-group]")).toHaveLength(3);
    expect(container.querySelectorAll("[data-model-assignment-row]")).toHaveLength(3);
    expect(container.querySelector('[data-model-assignment-icon="assistant"]')?.tagName).toBe("svg");
    expect(container.querySelector('[data-model-assignment-icon="planner"]')?.tagName).toBe("svg");
    expect(container.querySelector('[data-model-assignment-icon="embedding"]')?.tagName).toBe("svg");

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

  it("edits an extension-owned child model pool from the central model roles view", async () => {
    const updateDraft = vi.fn();
    const user = userEvent.setup();
    const { container } = renderWithFrontendProviders(
      React.createElement(DefaultModelSection, {
        draftState: createDraftState(updateDraft),
        systemConfig: createSystemConfig(vi.fn(), { includeChildModelPool: true }),
      }),
    );

    expect(screen.getByText("子代理编排 · 子代理模型池")).toBeVisible();
    expect(screen.getByText("父运行当前模型")).toBeVisible();
    const modelPool = container.querySelector("[data-model-pool-assignment]");
    expect(modelPool).toBeInTheDocument();
    expect(within(modelPool).getByText("Chat Beta")).toBeVisible();
    expect(within(modelPool).getByText("provider-b")).toBeVisible();

    await user.click(screen.getByRole("switch", { name: "继承发起委派的模型" }));
    expect(updateDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        Extensions: {
          "agent-delegation": {
            Configuration: {
              modelPool: { inheritParent: false, modelProviderIds: ["chat-b"] },
            },
          },
        },
      }),
      "immediate",
    );

    await user.click(screen.getByRole("button", { name: "添加候选模型" }));
    await user.click(screen.getByRole("menuitem", { name: /Chat Alpha/ }));
    expect(updateDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({
        Extensions: {
          "agent-delegation": {
            Configuration: {
              modelPool: { inheritParent: true, modelProviderIds: ["chat-b", "chat-a"] },
            },
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

function createSystemConfig(setDefaultProviderModel, { includeChildModelPool = false } = {}) {
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
    systemExtensions: includeChildModelPool ? [createChildModelPoolExtension()] : [],
    setDefaultProviderModel,
  };
}

function createChildModelPoolExtension() {
  return {
    id: "agent-delegation",
    version: "1.0.0",
    displayName: { "zh-CN": "子代理编排", "en-US": "Subagent orchestration" },
    description: { "zh-CN": "子代理", "en-US": "Subagents" },
    enabled: true,
    configured: false,
    tools: [],
    skillCount: 0,
    mcpServerCount: 0,
    configuration: {
      configured: false,
      value: {},
      defaults: { modelPool: { inheritParent: true, modelProviderIds: [] } },
      effectiveValue: { modelPool: { inheritParent: true, modelProviderIds: ["chat-b"] } },
      sections: [
        {
          name: "model-pool",
          label: { "zh-CN": "子代理模型池", "en-US": "Child model pool" },
          keyCount: 2,
          fields: [
            {
              ...createField(
                ["modelPool", "inheritParent"],
                {
                  "zh-CN": "继承父运行模型",
                  "en-US": "Inherit parent model",
                },
                undefined,
                true,
              ),
              section: "model-pool",
              type: "boolean",
            },
            {
              ...createField(
                ["modelPool", "modelProviderIds"],
                { "zh-CN": "候选子代理模型", "en-US": "Child model candidates" },
                {
                  id: "agent-delegation-model-pool",
                  capability: "Chat",
                  valueKind: "model-id",
                  mutation: "config",
                  cardinality: "many",
                  inheritance: { source: "parent-model", path: ["modelPool", "inheritParent"] },
                  required: false,
                },
                ["chat-b"],
              ),
              section: "model-pool",
              type: "array",
              itemType: "string",
              placeholder: { "zh-CN": "添加候选模型", "en-US": "Add a candidate model" },
            },
          ],
        },
      ],
    },
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
