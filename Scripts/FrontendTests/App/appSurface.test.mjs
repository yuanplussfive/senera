import { describe, expect, it } from "vitest";
import {
  buildWebSettingsLocation,
  createSettingsHistoryState,
  isSettingsHistoryState,
  readWebSettingsSection,
  resolveAppSurface,
  resolveSettingsSection,
} from "../../../Frontend/src/app/appSurface.ts";

describe("resolveAppSurface", () => {
  it("keeps web locations on the main app surface", () => {
    expect(resolveAppSurface({ search: "", hash: "" })).toBe("main");
    expect(resolveAppSurface({ search: "?surface=settings&section=appearance", hash: "" })).toBe("main");
  });

  it("uses the standalone settings surface only for desktop", () => {
    expect(resolveAppSurface({ search: "?surface=settings", hash: "" }, true)).toBe("settings");
    expect(resolveAppSurface({ search: "", hash: "#/settings/appearance" }, true)).toBe("settings");
  });
});

describe("settings location", () => {
  it("uses the first settings section as the default", () => {
    expect(resolveSettingsSection({ search: "?settings=unknown", hash: "" })).toBe("model-service");
  });

  it("reads canonical and legacy settings links", () => {
    expect(readWebSettingsSection({ search: "?settings=skills", hash: "" })).toBe("skills");
    expect(readWebSettingsSection({ search: "?surface=settings&section=appearance", hash: "" })).toBe("appearance");
    expect(readWebSettingsSection({ search: "", hash: "" })).toBeNull();
  });

  it("builds canonical overlay locations without legacy parameters", () => {
    expect(
      buildWebSettingsLocation(
        { pathname: "/chat/one", search: "?surface=settings&section=appearance&foo=1", hash: "#/settings/appearance" },
        "skills",
      ),
    ).toBe("/chat/one?foo=1&settings=skills");
    expect(buildWebSettingsLocation({ pathname: "/chat/one", search: "?foo=1&settings=skills", hash: "" }, null)).toBe(
      "/chat/one?foo=1",
    );
  });

  it("marks history entries created by the settings overlay", () => {
    const state = createSettingsHistoryState({ existing: true });
    expect(state).toMatchObject({ existing: true, seneraSettingsOverlay: true });
    expect(isSettingsHistoryState(state)).toBe(true);
    expect(isSettingsHistoryState({})).toBe(false);
  });
});
