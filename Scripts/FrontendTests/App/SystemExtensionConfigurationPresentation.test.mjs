import { describe, expect, it } from "vitest";
import { FrontendLocales } from "../../../Frontend/src/i18n/frontendLocaleModel.ts";
import { projectSystemExtensionConfigurationSections } from "../../../Frontend/src/features/settings/systemExtensionConfigurationPresentation.ts";

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
});

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
            defaultItem: { Capabilities: { Vision: false } },
            effectiveValue: [
              {
                Id: "vision-model",
                ProviderId: "openai",
                Model: "gpt-vision",
                Endpoint: "ChatCompletions",
                Capabilities: { Vision: true },
              },
              {
                Id: "chat-model",
                ProviderId: "openai",
                Model: "gpt-chat",
                Endpoint: "ChatCompletions",
                Capabilities: { Vision: false },
              },
              {
                Id: "disabled-vision",
                ProviderId: "disabled",
                Model: "disabled-vision",
                Endpoint: "ChatCompletions",
                Capabilities: { Vision: true },
              },
            ],
          },
        ],
      },
    ],
  },
};
