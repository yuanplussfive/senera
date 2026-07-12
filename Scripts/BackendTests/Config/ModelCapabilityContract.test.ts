import { describe, expect, test } from "vitest";
import { AgentDefaults } from "../../../Source/AgentSystem/Defaults/AgentDefaultCatalog.js";
import { ModelCapabilitiesSchema } from "../../../Source/AgentSystem/Schemas/AgentModelConfigSchema.js";

describe("Model capability contract", () => {
  test("keeps default capabilities aligned with the strict runtime schema", () => {
    expect(ModelCapabilitiesSchema.parse(AgentDefaults.ModelRuntime.Capabilities)).toEqual(
      AgentDefaults.ModelRuntime.Capabilities,
    );
  });

  test("rejects capabilities outside the provider-independent runtime contract", () => {
    expect(
      ModelCapabilitiesSchema.safeParse({
        ...AgentDefaults.ModelRuntime.Capabilities,
        ProviderNativeTools: true,
      }),
    ).toMatchObject({ success: false });
  });
});
