import { createRequire } from "node:module";
import path from "node:path";
import {
  createPluginConfigurationArtifacts,
  definePluginConfiguration,
  parsePluginTomlConfig,
  z,
} from "@senera/tool-plugin-sdk";
import { describe, expect, test } from "vitest";

const nodeRequire = createRequire(import.meta.url);

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
              { path: ["service", "enabled"], label: "Enabled", type: "boolean", required: false, essential: true },
              {
                path: ["service", "endpoints"],
                label: "Endpoints",
                type: "array",
                itemType: "string",
                required: false,
                essential: false,
              },
              {
                path: ["service", "nested", "api key"],
                label: "API key",
                type: "string",
                secret: true,
                required: true,
                essential: true,
              },
              { path: ["service", "headers"], label: "Headers", type: "table", required: false, essential: false },
            ],
          },
        ],
      },
    });

    const artifacts = createPluginConfigurationArtifacts(configuration);

    expect(artifacts.exampleToml).toContain("# Enabled\nenabled = true");
    expect(artifacts.exampleToml).toContain("# Headers\n[service.headers]");
    expect(artifacts.schemaToml).toContain("required = true");
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
              fields: [
                { path: ["service", "value"], label: "Value", type: "string", required: false, essential: false },
              ],
            },
          ],
        },
      }),
    ).toThrow("contains an unsupported TOML value");
  });

  test("keeps the bundled weather plugin on one explicit QWeather contract", () => {
    const { configuration } = nodeRequire(
      path.join(process.cwd(), "Plugins", "WeatherToolPlugin", "PluginConfig.definition.cjs"),
    ) as {
      configuration: {
        defaults: { weather: Record<string, unknown> };
        form: { sections: Array<{ id: string; fields: Array<{ path: string[]; required?: boolean }> }> };
      };
    };
    const weatherFields = configuration.form.sections.find((section) => section.id === "weather")?.fields ?? [];
    const fieldPaths = weatherFields.map((field) => field.path.join("."));

    expect(Object.keys(configuration.defaults.weather)).not.toContain("provider");
    expect(fieldPaths).not.toContain("weather.provider");
    expect(fieldPaths).not.toContain("weather.weather_api_host");
    expect(fieldPaths).not.toContain("weather.base_url");
    expect(fieldPaths).not.toContain("weather.geo_base_url");
    expect(weatherFields.find((field) => field.path.join(".") === "weather.api_host")?.required).toBe(true);
  });
});
