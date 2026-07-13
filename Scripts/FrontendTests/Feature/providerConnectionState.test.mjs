import { describe, expect, it } from "vitest";
import {
  applyProviderConnectionDraftPatch,
  buildProviderEndpointMutationInput,
  readProviderConnectionDraftState,
  readProviderConnectionState,
  resetProviderConnectionDraft,
} from "../../../Frontend/src/features/settings/sections/providerConnectionState.ts";

describe("providerConnectionState", () => {
  it("reads effective provider endpoints so built-in providers remain visible", () => {
    const state = readProviderConnectionState({
      catalogs: {},
      errors: {},
      loadingIds: {},
      section: createModelsSection({
        effectiveEndpoints: [
          { Id: "openai", Enabled: true, BaseUrl: "https://api.openai.com/v1" },
          { Id: "custom", Enabled: true, BaseUrl: "https://custom.example.test/v1" },
        ],
        effectiveModels: [],
      }),
      snapshotValue: {
        ModelProviderEndpoints: [{ Id: "custom", Enabled: true, BaseUrl: "https://custom.example.test/v1" }],
        ModelProviders: [],
      },
    });

    expect(state.providers.map((provider) => provider.Id)).toEqual(["openai", "custom"]);
  });

  it("keeps connection edits local until an explicit endpoint mutation is built", () => {
    const acceptedProvider = {
      Id: "custom",
      Enabled: true,
      BaseUrl: "https://saved.example.test/v1",
      ApiKey: "saved-key",
    };
    const editedDraft = applyProviderConnectionDraftPatch({
      acceptedProvider,
      currentDraft: null,
      patch: {
        BaseUrl: "https://draft.example.test/v1",
        ApiKey: "draft-key",
      },
    });

    const draftState = readProviderConnectionDraftState({
      acceptedProvider,
      draftProvider: editedDraft,
    });

    expect(draftState.dirty).toBe(true);
    expect(acceptedProvider).toMatchObject({
      BaseUrl: "https://saved.example.test/v1",
      ApiKey: "saved-key",
    });

    const mutation = buildProviderEndpointMutationInput(draftState.connectionDraft);
    expect(mutation).toMatchObject({
      ok: true,
      providerId: "custom",
      endpoint: {
        Id: "custom",
        BaseUrl: "https://draft.example.test/v1",
        ApiKey: "draft-key",
      },
    });
  });

  it("resets cancel state from the latest accepted provider snapshot", () => {
    const acceptedProvider = {
      Id: "custom",
      Enabled: false,
      BaseUrl: "https://accepted.example.test/v1",
      Headers: { "x-senera": "accepted" },
    };

    expect(resetProviderConnectionDraft(acceptedProvider)).toEqual(acceptedProvider);
  });

  it("trims provider ids before confirm or fetch payloads", () => {
    expect(
      buildProviderEndpointMutationInput({
        Id: "  custom  ",
        Enabled: true,
        BaseUrl: "https://draft.example.test/v1",
      }),
    ).toMatchObject({
      ok: true,
      providerId: "custom",
      endpoint: {
        Id: "custom",
        BaseUrl: "https://draft.example.test/v1",
      },
    });
  });

  it("blocks empty provider ids without producing a save or fetch payload", () => {
    expect(
      buildProviderEndpointMutationInput({
        Id: "   ",
        BaseUrl: "https://draft.example.test/v1",
      }),
    ).toEqual({
      ok: false,
      message: "供应商 ID 不能为空。",
    });
  });
});

function createModelsSection({ effectiveEndpoints, effectiveModels }) {
  return {
    name: "models",
    label: "模型",
    keyCount: 4,
    fields: [
      createField("ModelProviderEndpoints", effectiveEndpoints),
      createField("ModelProviders", effectiveModels),
      createField("ModelGroups", undefined),
      createField("DefaultModelProviderId", undefined),
    ],
  };
}

function createField(key, effectiveValue) {
  return {
    label: key,
    section: "models",
    key,
    path: [key],
    type: "array",
    value: undefined,
    effectiveValue,
    configured: effectiveValue !== undefined,
  };
}
