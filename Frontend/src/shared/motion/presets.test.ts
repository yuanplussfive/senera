import { describe, expect, it } from "vitest";
import { readDrawerVariants } from "./presets";

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
