import type { SVGProps } from "react";
import { cn } from "../../lib/util";

export type WindowControlGlyphName = "minimize" | "maximize" | "restore" | "close";

/** 1.5 units at a 16px render is exactly one device-independent pixel. */
const WINDOW_CONTROL_STROKE_WIDTH = 1.5;

/**
 * Path centers are constrained to the 0.75-unit grid and to a 13.5-unit
 * centerline box (5.25..18.75), a 10px painted footprint at 16px.
 * `minimize` sits one half-unit below that box's middle because a lone
 * horizontal bar reads optically high when centered on the math axis.
 */
const WINDOW_CONTROL_GLYPHS: Record<WindowControlGlyphName, JSX.Element> = {
  minimize: <path d="M5.25 12.75h13.5" />,
  maximize: <rect x="5.25" y="5.25" width="13.5" height="13.5" rx="0.75" />,
  restore: (
    <>
      <rect x="5.25" y="8.25" width="10.5" height="10.5" rx="0.75" />
      <path d="M8.25 8.25V5.25h10.5v10.5h-3" />
    </>
  ),
  close: (
    <>
      <path d="M5.25 5.25 18.75 18.75" />
      <path d="M18.75 5.25 5.25 18.75" />
    </>
  ),
};

/**
 * Desktop window-bar glyphs drawn as one family so the three controls read at
 * the same weight.
 *
 * Generic icon sets cannot do this. Heroicons centers strokes on whole viewBox
 * units (`M5 12h14`), so at a 16px render the minimize line falls on an integer
 * pixel row and its 1.75-unit stroke splits across two rows at ~59% opacity
 * each, while the box and X land on half-pixel rows and paint at full opacity.
 * One nominal stroke width, visibly different ink. Here every stroke center
 * sits on the 0.75-unit grid, where 0.75 unit = 0.5px, so 1.5 units paint
 * exactly 1.0px on a single pixel row — a platform title-bar weight.
 *
 * This sits alongside `AppIcon` rather than inside its catalog: the catalog is
 * the shared semantic vocabulary for feature code, while these four shapes are
 * app-chrome geometry whose whole reason to exist is the pixel phase above.
 * Feature code keeps using `AppIcon`.
 */
export function WindowControlGlyph({
  glyph,
  size = 16,
  className,
  ...props
}: Omit<SVGProps<SVGSVGElement>, "height" | "width" | "strokeWidth"> & {
  glyph: WindowControlGlyphName;
  size?: number | string;
}): JSX.Element {
  return (
    <svg
      {...props}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={WINDOW_CONTROL_STROKE_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props["aria-label"] || props["aria-labelledby"] ? undefined : true}
      focusable="false"
      className={cn("shrink-0", className)}
      data-window-control-glyph={glyph}
    >
      {WINDOW_CONTROL_GLYPHS[glyph]}
    </svg>
  );
}
