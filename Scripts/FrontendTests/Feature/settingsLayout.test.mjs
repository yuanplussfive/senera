import { describe, expect, it } from "vitest";
import {
  classifySettingsContentLayout,
  classifySettingsShellLayout,
} from "../../../Frontend/src/shared/responsive/settingsLayout.ts";

describe("settings container layout breakpoints", () => {
  it("switches the settings navigation at the 800px container boundary", () => {
    expect(classifySettingsShellLayout(799)).toBe("compact");
    expect(classifySettingsShellLayout(800)).toBe("persistent");
  });

  it("switches list-detail workspaces at the 720px and 1100px boundaries", () => {
    expect(classifySettingsContentLayout(719)).toBe("compact");
    expect(classifySettingsContentLayout(720)).toBe("standard");
    expect(classifySettingsContentLayout(1099)).toBe("standard");
    expect(classifySettingsContentLayout(1100)).toBe("wide");
  });
});
