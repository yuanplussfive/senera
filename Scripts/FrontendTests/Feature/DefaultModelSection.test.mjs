import React from "react";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
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

    expect(screen.queryByText("必填")).not.toBeInTheDocument();
    expect(container.querySelectorAll("[data-model-assignment-group]")).toHaveLength(2);
    expect(container.querySelectorAll("[data-model-assignment-row]")).toHaveLength(2);
    expect(container.querySelector('[data-model-assignment-icon="assistant"]')?.tagName).toBe("svg");
    expect(container.querySelector('[data-model-assignment-icon="final-answer"]')?.tagName).toBe("svg");

    await user.click(screen.getByRole("combobox", { name: "默认模型" }));
    expect(screen.queryByRole("option", { name: /embedding-alpha/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: /Chat Beta/ }));
    expect(setDefaultProviderModel).toHaveBeenCalledWith("chat-b");

    await user.click(screen.getByRole("combobox", { name: "最终回答模型" }));
    expect(screen.queryByRole("option", { name: /embedding-alpha/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: /Chat Beta/ }));
    expect(updateDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        ActionPlanner: { FinalAnswerClient: { ModelProviderId: "chat-b" } },
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

    const extensionToggle = screen.getByRole("button", { name: "子代理编排" });
    expect(extensionToggle).toHaveAttribute("aria-expanded", "false");
    await user.click(extensionToggle);
    expect(extensionToggle).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(screen.getByText("候选模型")).toBeVisible());
    expect(screen.getByText("继承发起模型")).toBeVisible();
    const modelPool = container.querySelector("[data-model-pool-assignment]");
    expect(modelPool).toBeInTheDocument();
    await waitFor(() => {
      expect(within(modelPool).getByText("Chat Beta")).toBeVisible();
      expect(within(modelPool).getByText("Chat Beta").closest("[title]")).toBeNull();
      expect(within(modelPool).queryByText("provider-b")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("switch", { name: "继承发起模型" }));
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

    await user.click(screen.getByRole("combobox", { name: "添加候选模型" }));
    await user.click(screen.getByRole("option", { name: /Chat Alpha/ }));
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
  it("exposes extension model slots through a switch-controlled disclosure", async () => {
    const updateDraft = vi.fn();
    const user = userEvent.setup();
    renderWithFrontendProviders(
      React.createElement(DefaultModelSection, {
        draftState: createDraftState(updateDraft),
        systemConfig: createSystemConfig(vi.fn(), { includeImageModels: true }),
      }),
    );

    const imageSwitch = screen.getByRole("switch", { name: "开启 图像 的模型设置" });
    expect(imageSwitch).toBeChecked();
    expect(screen.getByRole("combobox", { name: "视觉模型" })).toBeVisible();
    expect(screen.getByText("留空时优先使用当前会话模型。")).toBeVisible();

    await user.click(imageSwitch);
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "视觉模型" })).not.toBeInTheDocument());
    expect(screen.queryByRole("combobox", { name: "图像生成模型" })).not.toBeInTheDocument();
    expect(screen.getByText("已选择的模型仍会生效。")).toBeVisible();

    await user.click(imageSwitch);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "视觉模型" })).toBeVisible());
    await user.click(screen.getByRole("combobox", { name: "视觉模型" }));
    await user.click(screen.getByRole("option", { name: /Chat Alpha/ }));
    expect(updateDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        Extensions: { "agent-image-tools": { Configuration: { model: { modelProviderId: "chat-a" } } } },
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

function createSystemConfig(
  setDefaultProviderModel,
  { includeChildModelPool = false, includeImageModels = false } = {},
) {
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
            createField(["ActionPlanner", "FinalAnswerClient", "ModelProviderId"], "最终回答模型", {
              id: "final-answer",
              capability: "Chat",
              valueKind: "model-id",
              mutation: "config",
              required: true,
            }),
          ]),
        ],
      },
    },
    providerModelCatalogs: {},
    providerModelErrors: {},
    providerModelLoadingIds: {},
    providerModelOperations: {},
    systemExtensions: [
      ...(includeChildModelPool ? [createChildModelPoolExtension()] : []),
      ...(includeImageModels ? [createImageModelExtension()] : []),
    ],
    setDefaultProviderModel,
  };
}

function createChildModelPoolExtension() {
  return {
    id: "agent-delegation",
    displayName: { "zh-CN": "子代理编排", "en-US": "Subagent orchestration" },
    description: { "zh-CN": "子代理", "en-US": "Subagents" },
    presentation: { icon: "users" },
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
          label: { "zh-CN": "模型池", "en-US": "Model pool" },
          keyCount: 2,
          fields: [
            {
              ...createField(
                ["modelPool", "inheritParent"],
                {
                  "zh-CN": "继承发起模型",
                  "en-US": "Inherit delegating model",
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
                { "zh-CN": "候选模型", "en-US": "Candidate models" },
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

function createImageModelExtension() {
  const visionField = {
    ...createField(
      ["model", "modelProviderId"],
      { "zh-CN": "视觉模型", "en-US": "Vision model" },
      {
        id: "agent-image-tools.vision-model",
        capability: "Chat",
        valueKind: "model-id",
        mutation: "config",
        required: false,
      },
      "chat-b",
    ),
    section: "model",
    type: "string",
    placeholder: { "zh-CN": "自动（会话模型优先）", "en-US": "Automatic (prefer conversation model)" },
  };
  const generationField = {
    ...createField(
      ["generation", "modelProviderId"],
      { "zh-CN": "图像生成模型", "en-US": "Image generation model" },
      {
        id: "agent-image-tools.generation-model",
        capability: "Chat",
        valueKind: "model-id",
        mutation: "config",
        required: false,
      },
      "chat-a",
    ),
    section: "generation",
    type: "string",
  };
  return {
    id: "agent-image-tools",
    displayName: { "zh-CN": "图像", "en-US": "Images" },
    description: { "zh-CN": "理解、生成和编辑图片。", "en-US": "Understand, generate, and edit images." },
    presentation: { icon: "image" },
    enabled: true,
    configured: false,
    tools: [],
    skillCount: 0,
    mcpServerCount: 0,
    configuration: {
      configured: false,
      value: { model: { modelProviderId: "chat-b" }, generation: { modelProviderId: "chat-a" } },
      defaults: {},
      effectiveValue: {},
      sections: [
        {
          name: "model",
          label: { "zh-CN": "模型选择", "en-US": "Model selection" },
          description: {
            "zh-CN": "留空时优先使用当前会话模型。",
            "en-US": "Falls back to the conversation model when empty.",
          },
          keyCount: 1,
          fields: [visionField],
        },
        {
          name: "generation",
          label: { "zh-CN": "生成与编辑", "en-US": "Generation and editing" },
          keyCount: 1,
          fields: [generationField],
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
          : "other",
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
