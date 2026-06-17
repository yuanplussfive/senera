import { describe, expect, it } from "vitest";
import {
  defaultResponsiveQueryMatches,
  deriveResponsiveMode,
  type ResponsiveQueryMatches,
} from "./responsiveMode";

function matches(overrides: Partial<ResponsiveQueryMatches>): ResponsiveQueryMatches {
  return { ...defaultResponsiveQueryMatches, ...overrides };
}

describe("deriveResponsiveMode", () => {
  it("maps viewport breakpoints to persistent panel capabilities", () => {
    expect(deriveResponsiveMode(matches({}))).toMatchObject({
      viewport: "mobile",
      hasPersistentSessionPanel: false,
      hasPersistentWorkflowPanel: false,
      prefersDrawerNavigation: true,
      prefersCompactControls: true,
    });

    expect(deriveResponsiveMode(matches({ tabletUp: true }))).toMatchObject({
      viewport: "tablet",
      hasPersistentSessionPanel: false,
      hasPersistentWorkflowPanel: false,
      prefersDrawerNavigation: false,
      prefersCompactControls: false,
    });

    expect(deriveResponsiveMode(matches({ tabletUp: true, desktopUp: true }))).toMatchObject({
      viewport: "desktop",
      hasPersistentSessionPanel: false,
      hasPersistentWorkflowPanel: true,
      prefersDrawerNavigation: false,
    });

    expect(deriveResponsiveMode(matches({ tabletUp: true, desktopUp: true, wideUp: true }))).toMatchObject({
      viewport: "wide",
      hasPersistentSessionPanel: true,
      hasPersistentWorkflowPanel: true,
    });
  });

  it("uses coarse pointer capability for compact controls beyond width alone", () => {
    expect(deriveResponsiveMode(matches({ tabletUp: true, hasAnyCoarsePointer: true }))).toMatchObject({
      viewport: "tablet",
      isCoarsePointer: true,
      prefersCompactControls: true,
    });

    expect(deriveResponsiveMode(matches({ tabletUp: true, supportsHover: true }))).toMatchObject({
      viewport: "tablet",
      supportsHover: true,
      isCoarsePointer: false,
      prefersCompactControls: false,
    });
  });

  it("keeps reduced motion as a capability without changing viewport decisions", () => {
    expect(deriveResponsiveMode(matches({ desktopUp: true, prefersReducedMotion: true }))).toMatchObject({
      viewport: "desktop",
      prefersReducedMotion: true,
      hasPersistentWorkflowPanel: true,
    });
  });
});
