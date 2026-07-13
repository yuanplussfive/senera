import { describe, expect, it } from "vitest";
import { buildSettingsSurfaceSyncRequests } from "../../../Frontend/src/app/settingsSurfaceSync.ts";
describe("buildSettingsSurfaceSyncRequests", () => {
  it("keeps the independent settings surface scoped to settings workbench data", () => {
    expect(buildSettingsSurfaceSyncRequests()).toEqual([
      { type: "config.get" },
      { type: "model.list" },
      { type: "plugin.config.list" },
    ]);
  });
});
