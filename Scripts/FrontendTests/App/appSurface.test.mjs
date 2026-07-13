import { describe, expect, it } from "vitest";
import { resolveAppSurface, resolveSettingsSection } from "../../../Frontend/src/app/appSurface.ts";

describe("resolveAppSurface", () => {
  it("uses the main app surface by default", () => {
    expect(resolveAppSurface({ search: "", hash: "" })).toBe("main");
  });

  it("uses the settings surface from query parameters", () => {
    expect(resolveAppSurface({ search: "?surface=settings", hash: "" })).toBe("settings");
    expect(resolveAppSurface({ search: "?view=settings", hash: "" })).toBe("settings");
  });

  it("uses the settings surface from hash routes", () => {
    expect(resolveAppSurface({ search: "", hash: "#/settings" })).toBe("settings");
    expect(resolveAppSurface({ search: "", hash: "#settings/appearance" })).toBe("settings");
  });
});

describe("resolveSettingsSection", () => {
  it("uses the first settings section as the default", () => {
    expect(resolveSettingsSection({ search: "?surface=settings", hash: "" })).toBe("model-service");
  });

  it("uses a valid settings section from query parameters", () => {
    expect(resolveSettingsSection({ search: "?surface=settings&section=skills", hash: "" })).toBe("skills");
  });

  it("uses a valid settings section from hash routes", () => {
    expect(resolveSettingsSection({ search: "", hash: "#/settings/skills" })).toBe("skills");
  });

  it("falls back for retired providers/models section IDs", () => {
    expect(resolveSettingsSection({ search: "?surface=settings&section=providers", hash: "" })).toBe("model-service");
    expect(resolveSettingsSection({ search: "?surface=settings&section=models", hash: "" })).toBe("model-service");
    expect(resolveSettingsSection({ search: "", hash: "#/settings/providers" })).toBe("model-service");
    expect(resolveSettingsSection({ search: "", hash: "#/settings/models" })).toBe("model-service");
  });

  it("accepts the dedicated default-model route", () => {
    expect(resolveSettingsSection({ search: "?surface=settings&section=default-model", hash: "" })).toBe("default-model");
    expect(resolveSettingsSection({ search: "", hash: "#/settings/default-model" })).toBe("default-model");
  });
});
