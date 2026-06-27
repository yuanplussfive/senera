import { describe, expect, it } from "vitest";
import {
  readDialogPanelTransition,
  readDialogPanelVariants,
  readDrawerVariants,
  readOverlayTransition,
  readOverlayVariants,
} from "./presets";

describe("dialog motion presets", () => {
  it("uses lightweight modal scale motion", () => {
    expect(readDialogPanelVariants("full", "modal")).toMatchObject({
      hidden: { opacity: 0, scale: 0.985 },
      show: { opacity: 1, scale: 1 },
      exit: { opacity: 0, scale: 0.99 },
    });
  });

  it("uses opacity-only dialog motion when reduced motion is active", () => {
    expect(readDialogPanelVariants("reduced", "modal")).toEqual({
      hidden: { opacity: 0 },
      show: { opacity: 1 },
      exit: { opacity: 0 },
    });
  });

  it("hides force-mounted dialogs immediately when motion is disabled", () => {
    expect(readDialogPanelVariants("none", "modal")).toEqual({
      hidden: { opacity: 0 },
      show: { opacity: 1 },
      exit: { opacity: 0 },
    });
    expect(readOverlayVariants("none")).toEqual({
      hidden: { opacity: 0 },
      show: { opacity: 1 },
      exit: { opacity: 0 },
    });
  });

  it("keeps modal close motion shorter than open motion", () => {
    expect(readDialogPanelTransition("full", "modal", "show")).toMatchObject({ duration: 0.16 });
    expect(readDialogPanelTransition("full", "modal", "exit")).toMatchObject({ duration: 0.1 });
  });

  it("fades overlays in before fading them out", () => {
    expect(readOverlayVariants("full")).toEqual({
      hidden: { opacity: 0 },
      show: { opacity: 1 },
      exit: { opacity: 0 },
    });
    expect(readOverlayTransition("full", "show")).toMatchObject({ duration: 0.16 });
    expect(readOverlayTransition("full", "exit")).toMatchObject({ duration: 0.1 });
  });
});

describe("readDrawerVariants", () => {
  it("keeps no-motion left drawers offscreen when hidden or closed", () => {
    expect(readDrawerVariants("none", "left")).toMatchObject({
      hidden: { opacity: 1, x: "-100%" },
      show: { opacity: 1, x: 0 },
      exit: { opacity: 1, x: "-100%" },
    });
  });

  it("keeps no-motion right drawers offscreen when hidden or closed", () => {
    expect(readDrawerVariants("none", "right")).toMatchObject({
      hidden: { opacity: 1, x: "100%" },
      show: { opacity: 1, x: 0 },
      exit: { opacity: 1, x: "100%" },
    });
  });
});
