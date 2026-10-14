export interface WindowControlsOverlayGeometry {
  readonly visible: boolean;
  getTitlebarAreaRect: () => Pick<DOMRect, "width" | "x">;
}

export interface WindowLayoutRect {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export function readWindowControlsInsetWidth({
  fallbackWidth,
  overlay,
  viewportWidth,
}: {
  fallbackWidth: number;
  overlay?: WindowControlsOverlayGeometry;
  viewportWidth: number;
}): number {
  const rect = overlay?.getTitlebarAreaRect();
  return overlay?.visible && rect ? Math.max(0, viewportWidth - rect.x - rect.width) : fallbackWidth;
}

/**
 * Computes the trailing space a surface needs when custom window controls overlap it.
 * Rendered geometry keeps split panes and window resizes independent of platform guesses.
 */
export function readWindowControlsOverlapWidth({
  containerRect,
  controlsRect,
  gap = 0,
}: {
  containerRect: WindowLayoutRect;
  controlsRect?: WindowLayoutRect;
  gap?: number;
}): number {
  if (!controlsRect) return 0;
  if (controlsRect.bottom <= containerRect.top || controlsRect.top >= containerRect.bottom) return 0;

  const overlap = Math.min(containerRect.right, controlsRect.right) - Math.max(containerRect.left, controlsRect.left);
  return overlap > 0 ? overlap + Math.max(0, gap) : 0;
}
