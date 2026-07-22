import {
  createPluginConfigurationArtifacts,
  definePluginConfiguration,
  parsePluginTomlConfig,
  z,
} from "@senera/tool-plugin-sdk";
import { describe, expect, test } from "vitest";

describe("plugin configuration artifacts", () => {
  test("renders declared defaults structurally without reinterpreting serialized TOML", () => {
    const configuration = definePluginConfiguration({
      schema: z
        .object({
          service: z
            .object({
              enabled: z.boolean(),
              endpoints: z.array(z.string()),
              nested: z.object({ "api key": z.string() }),
              headers: z.record(z.string(), z.string()),
            })
            .strict(),
        })
        .strict(),
      defaults: {
        service: {
          enabled: true,
          endpoints: ["https://example.test/v1", "https://example.test/v2"],
          nested: { "api key": "secret\nvalue" },
          headers: {},
        },
      },
      form: {
        sections: [
          {
            id: "service",
            label: "Service",
            fields: [
              { path: ["service", "enabled"], label: "Enabled", type: "boolean" },
              { path: ["service", "endpoints"], label: "Endpoints", type: "array", itemType: "string" },
              { path: ["service", "nested", "api key"], label: "API key", type: "string", secret: true },
              { path: ["service", "headers"], label: "Headers", type: "table" },
            ],
          },
        ],
      },
    });

    const artifacts = createPluginConfigurationArtifacts(configuration);

    expect(artifacts.exampleToml).toContain("# Enabled\nenabled = true");
    expect(artifacts.exampleToml).toContain("# Headers\n[service.headers]");
    expect(parsePluginTomlConfig(artifacts.exampleToml)).toEqual(configuration.defaults);
  });

  test("rejects defaults that cannot be represented in TOML at declaration time", () => {
    expect(() =>
      definePluginConfiguration({
        schema: z.object({ service: z.object({ value: z.unknown() }).strict() }).strict(),
        defaults: { service: { value: new Date() } },
        form: {
          sections: [
            {
              id: "service",
              label: "Service",
              fields: [{ path: ["service", "value"], label: "Value", type: "string" }],
            },
          ],
        },
      }),
    ).toThrow("contains an unsupported TOML value");
  });
});
