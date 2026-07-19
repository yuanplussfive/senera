import { describe, expect, it } from "vitest";
import {
  readProviderModelRows,
} from "../../../Frontend/src/features/chat/modelConfigData.ts";
describe("model configuration helpers", () => {
  it("keeps configured local rows available when the remote catalog is empty", () => {
    expect(
      readProviderModelRows({
        catalogModels: [],
        configuredOnly: false,
        providerId: "local",
        search: "",
        models: [{ Id: "local/local-only", ProviderId: "local", Endpoint: "chat", Model: "local-only" }],
      }),
    ).toEqual([{ id: "local-only", ownedBy: "local" }]);
  });
});
