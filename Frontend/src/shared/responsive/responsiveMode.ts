export type ResponsiveViewport = "mobile" | "tablet" | "desktop" | "wide";

export interface ResponsiveQueryMatches {
  tabletUp: boolean;
  desktopUp: boolean;
  wideUp: boolean;
  workflowInlineUp: boolean;
  supportsHover: boolean;
  hasPrimaryCoarsePointer: boolean;
  hasAnyCoarsePointer: boolean;
  prefersReducedMotion: boolean;
}

export interface ResponsiveMode {
  viewport: ResponsiveViewport;
  hasPersistentSessionPanel: boolean;
  hasPersistentWorkflowPanel: boolean;
  hasInlineWorkflowPanel: boolean;
  prefersCompactControls: boolean;
  supportsHover: boolean;
  isCoarsePointer: boolean;
  prefersReducedMotion: boolean;
}

export const responsiveMediaQueries = {
  tabletUp: "(min-width: 768px)",
  desktopUp: "(min-width: 1024px)",
  wideUp: "(min-width: 1536px)",
  workflowInlineUp: "(min-width: 1280px)",
  supportsHover: "(hover: hover)",
  hasPrimaryCoarsePointer: "(pointer: coarse)",
  hasAnyCoarsePointer: "(any-pointer: coarse)",
  prefersReducedMotion: "(prefers-reduced-motion: reduce)",
} as const satisfies Record<keyof ResponsiveQueryMatches, string>;

export const defaultResponsiveQueryMatches: ResponsiveQueryMatches = {
  tabletUp: false,
  desktopUp: false,
  wideUp: false,
  workflowInlineUp: false,
  supportsHover: false,
  hasPrimaryCoarsePointer: false,
  hasAnyCoarsePointer: false,
  prefersReducedMotion: false,
};

export function deriveResponsiveMode(matches: ResponsiveQueryMatches): ResponsiveMode {
  const isCoarsePointer = matches.hasPrimaryCoarsePointer || matches.hasAnyCoarsePointer;
  const viewport: ResponsiveViewport = matches.wideUp
    ? "wide"
    : matches.desktopUp
      ? "desktop"
      : matches.tabletUp
        ? "tablet"
        : "mobile";

  return {
    viewport,
    hasPersistentSessionPanel: matches.desktopUp,
    hasPersistentWorkflowPanel: matches.desktopUp,
    hasInlineWorkflowPanel: matches.workflowInlineUp || matches.wideUp,
    prefersCompactControls: viewport === "mobile" || isCoarsePointer,
    supportsHover: matches.supportsHover,
    isCoarsePointer,
    prefersReducedMotion: matches.prefersReducedMotion,
  };
}

export function areResponsiveQueryMatchesEqual(left: ResponsiveQueryMatches, right: ResponsiveQueryMatches): boolean {
  return (
    left.tabletUp === right.tabletUp &&
    left.desktopUp === right.desktopUp &&
    left.wideUp === right.wideUp &&
    left.workflowInlineUp === right.workflowInlineUp &&
    left.supportsHover === right.supportsHover &&
    left.hasPrimaryCoarsePointer === right.hasPrimaryCoarsePointer &&
    left.hasAnyCoarsePointer === right.hasAnyCoarsePointer &&
    left.prefersReducedMotion === right.prefersReducedMotion
  );
}
