import { describe, expect, it } from "vitest";
import { FrontendLocales } from "../../../Frontend/src/i18n/frontendLocaleModel.ts";
import {
  projectSystemExtensionConfigurationSections,
  projectSystemExtensionRuntimeModelAssignmentSections,
} from "../../../Frontend/src/features/settings/systemExtensionConfigurationPresentation.ts";

describe("system extension configuration presentation", () => {
  it("localizes form metadata and projects enabled vision models as options", () => {
    const [section] = projectSystemExtensionConfigurationSections({
      sections: imageConfigurationSections,
      locale: FrontendLocales.EnUs,
      configSnapshot: modelConfigSnapshot,
    });

    expect(section).toMatchObject({
      label: "Model selection",
      description: "Choose a model.",
      fields: [
        expect.objectContaining({
          label: "Vision model",
          placeholder: "Automatic",
          options: ["vision-model"],
          optionLabels: { "vision-model": "gpt-vision · openai" },
        }),
      ],
    });
  });

  it("localizes package-declared enum option labels", () => {
    const [section] = projectSystemExtensionConfigurationSections({
      sections: thinkingConfigurationSections,
      locale: FrontendLocales.ZhCn,
      configSnapshot: null,
    });

    expect(section.fields[0]).toMatchObject({
      label: "默认 thinking",
      options: ["inherit", "high"],
      optionLabels: { inherit: "继承父运行", high: "高" },
    });
  });

  it("projects enabled extension model pools into the main config namespace", () => {
    const sections = projectSystemExtensionRuntimeModelAssignmentSections({
      extensions: [systemExtension("agent-delegation", true), systemExtension("disabled-delegation", false)],
      locale: FrontendLocales.EnUs,
      configSnapshot: modelConfigSnapshot,
    });

    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({
      name: "extension:agent-delegation:model-pool",
      label: "Subagents · Child model pool",
      fields: [
        expect.objectContaining({
          path: ["Extensions", "agent-delegation", "Configuration", "modelPool", "inheritParent"],
        }),
        expect.objectContaining({
          path: ["Extensions", "agent-delegation", "Configuration", "modelPool", "modelProviderIds"],
          options: ["chat-model", "vision-model"],
          modelSelection: expect.objectContaining({
            cardinality: "many",
            inheritance: {
              source: "parent-model",
              path: ["Extensions", "agent-delegation", "Configuration", "modelPool", "inheritParent"],
            },
          }),
        }),
      ],
    });
  });
});

function systemExtension(id, enabled) {
  return {
    id,
    version: "1.0.0",
    displayName: { "zh-CN": "子代理", "en-US": "Subagents" },
    description: { "zh-CN": "委派子任务。", "en-US": "Delegate child tasks." },
    enabled,
    configured: false,
    tools: [],
    skillCount: 1,
    mcpServerCount: 0,
    configuration: {
      configured: false,
      value: {},
      effectiveValue: { modelPool: { inheritParent: true, modelProviderIds: [] } },
      defaults: { modelPool: { inheritParent: true, modelProviderIds: [] } },
      sections: modelPoolConfigurationSections,
    },
  };
}

const modelPoolConfigurationSections = [
  {
    name: "model-pool",
    label: { "zh-CN": "子代理模型池", "en-US": "Child model pool" },
    keyCount: 2,
    fields: [
      {
        label: { "zh-CN": "继承父运行模型", "en-US": "Inherit parent model" },
        section: "model-pool",
        key: "inheritParent",
        path: ["modelPool", "inheritParent"],
        type: "boolean",
        value: undefined,
        effectiveValue: true,
        configured: false,
        missing: false,
        valueSource: "default",
        required: false,
        essential: true,
      },
      {
        label: { "zh-CN": "候选子代理模型", "en-US": "Child model candidates" },
        section: "model-pool",
        key: "modelProviderIds",
        path: ["modelPool", "modelProviderIds"],
        type: "array",
        itemType: "string",
        value: undefined,
        effectiveValue: [],
        configured: false,
        missing: false,
        valueSource: "default",
        required: false,
        essential: true,
        modelSelection: {
          id: "agent-delegation-model-pool",
          capability: "Chat",
          valueKind: "model-id",
          mutation: "config",
          cardinality: "many",
          inheritance: { source: "parent-model", path: ["modelPool", "inheritParent"] },
          required: false,
        },
      },
    ],
  },
];

const thinkingConfigurationSections = [
  {
    name: "defaults",
    label: { "zh-CN": "子代理默认能力", "en-US": "Child agent defaults" },
    keyCount: 1,
    fields: [
      {
        label: { "zh-CN": "默认 thinking", "en-US": "Default thinking" },
        section: "defaults",
        key: "thinkingLevel",
        path: ["defaults", "thinkingLevel"],
        type: "string",
        value: undefined,
        effectiveValue: "inherit",
        configured: false,
        missing: false,
        valueSource: "default",
        options: ["inherit", "high"],
        optionLabels: {
          inherit: { "zh-CN": "继承父运行", "en-US": "Inherit parent" },
          high: { "zh-CN": "高", "en-US": "High" },
        },
        required: false,
        essential: true,
      },
    ],
  },
];

const imageConfigurationSections = [
  {
    name: "model",
    label: { "zh-CN": "模型选择", "en-US": "Model selection" },
    description: { "zh-CN": "选择模型。", "en-US": "Choose a model." },
    keyCount: 1,
    fields: [
      {
        label: { "zh-CN": "视觉模型", "en-US": "Vision model" },
        placeholder: { "zh-CN": "自动", "en-US": "Automatic" },
        section: "model",
        key: "modelProviderId",
        path: ["model", "modelProviderId"],
        type: "string",
        value: undefined,
        effectiveValue: "",
        configured: false,
        missing: false,
        valueSource: "default",
        required: false,
        essential: true,
        modelSelection: {
          id: "image-model",
          capability: "Vision",
          valueKind: "model-id",
          mutation: "config",
          required: false,
        },
      },
    ],
  },
];

const modelConfigSnapshot = {
  form: {
    sections: [
      {
        name: "models",
        label: "Models",
        keyCount: 2,
        fields: [
          {
            key: "ModelProviderEndpoints",
            path: ["ModelProviderEndpoints"],
            effectiveValue: [
              { Id: "openai", Enabled: true },
              { Id: "disabled", Enabled: false },
            ],
          },
          {
            key: "ModelProviders",
            path: ["ModelProviders"],
            defaultItem: { Capabilities: { Chat: false, Vision: false } },
            effectiveValue: [
              {
                Id: "vision-model",
                ProviderId: "openai",
                Model: "gpt-vision",
                Endpoint: "ChatCompletions",
                Capabilities: { Chat: true, Vision: true },
              },
              {
                Id: "chat-model",
                ProviderId: "openai",
                Model: "gpt-chat",
                Endpoint: "ChatCompletions",
                Capabilities: { Chat: true, Vision: false },
              },
              {
                Id: "disabled-vision",
                ProviderId: "disabled",
                Model: "disabled-vision",
                Endpoint: "ChatCompletions",
                Capabilities: { Chat: true, Vision: true },
              },
            ],
          },
        ],
      },
    ],
  },
};
