import { describe, expect, it } from "vitest";
import { buildSettingsSurfaceSyncRequests } from "../../../Frontend/src/app/settingsSurfaceSync.ts";
describe("buildSettingsSurfaceSyncRequests", () => {
  it("keeps the independent settings surface scoped to settings workbench data", () => {
    expect(buildSettingsSurfaceSyncRequests("model-service")).toEqual([
      { type: "config.get" },
      { type: "workspace.get" },
      { type: "model.list" },
      { type: "systemTool.list" },
    ]);
    expect(buildSettingsSurfaceSyncRequests("model-roles")).toEqual([
      { type: "config.get" },
      { type: "workspace.get" },
      { type: "model.list" },
      { type: "systemTool.list" },
    ]);
  });
});
