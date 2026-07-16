import { describe, expect, it } from "vitest";
import { readDesktopTitleBarOverlay } from "../../../Frontend/src/app/DesktopWindowChrome.tsx";
import { readWindowControlsInsetWidth } from "../../../Frontend/src/shared/responsive/windowControlsLayout.ts";
import {
  createAppearanceSnapshot,
  defaultAppearancePreference,
} from "../../../Frontend/src/shared/theme/themeModel.ts";

describe("desktop window chrome", () => {
  it("derives the native controls inset through shared responsive geometry", () => {
    expect(
      readWindowControlsInsetWidth({
        fallbackWidth: 138,
        overlay: {
          visible: true,
          getTitlebarAreaRect: () => ({ width: 1302, x: 0 }),
        },
        viewportWidth: 1440,
      }),
    ).toBe(138);
    expect(readWindowControlsInsetWidth({ fallbackWidth: 138, viewportWidth: 1440 })).toBe(138);
  });

  it("projects the light appearance into native caption colors", () => {
    const snapshot = createAppearanceSnapshot({
      preference: { ...defaultAppearancePreference, themeMode: "light" },
      systemTheme: "dark",
    });

    expect(readDesktopTitleBarOverlay(snapshot)).toEqual({
      color: "#ffffff",
      symbolColor: "#17191c",
    });
  });

  it("projects the dark appearance into native caption colors", () => {
    const snapshot = createAppearanceSnapshot({
      preference: { ...defaultAppearancePreference, themeMode: "dark" },
      systemTheme: "light",
    });

    expect(readDesktopTitleBarOverlay(snapshot)).toEqual({
      color: "#242528",
      symbolColor: "#f5f7fa",
    });
  });
});
