import { describe, expect, it } from "vitest";
import { shouldUseCustomWindowControls } from "../../../Frontend/src/app/DesktopWindowChrome.tsx";
import { readWindowControlsInsetWidth } from "../../../Frontend/src/shared/responsive/windowControlsLayout.ts";

describe("desktop window chrome", () => {
  it("retains the shared native-controls geometry fallback for web-capable surfaces", () => {
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

  it("renders custom controls only for custom-framed desktop windows", () => {
    expect(shouldUseCustomWindowControls("custom")).toBe(true);
    expect(shouldUseCustomWindowControls("native")).toBe(false);
    expect(shouldUseCustomWindowControls(undefined)).toBe(false);
  });
});
