export interface WindowControlsOverlayGeometry {
  readonly visible: boolean;
  getTitlebarAreaRect: () => Pick<DOMRect, "width" | "x">;
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
