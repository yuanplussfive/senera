export interface WorkbenchViewport {
  width: number;
  height: number;
}

export interface WorkbenchWindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorkbenchWindowGeometryPolicy {
  inset: number;
  compactInset: number;
  defaultWidth: number;
  defaultHeight: number;
  defaultLeft: number;
  defaultTop: number;
  minWidth: number;
  minHeight: number;
  collapsedWidth: number;
  titlebarHeight: number;
  keyboardStep: number;
}

export type WorkbenchWindowMode = "normal" | "maximized" | "collapsed";

export function createDefaultWindowGeometry(
  viewport: WorkbenchViewport,
  policy: WorkbenchWindowGeometryPolicy,
): WorkbenchWindowGeometry {
  return clampWindowGeometry(
    {
      x: policy.defaultLeft,
      y: policy.defaultTop,
      width: policy.defaultWidth,
      height: policy.defaultHeight,
    },
    viewport,
    policy,
  );
}

export function clampWindowGeometry(
  geometry: WorkbenchWindowGeometry,
  viewport: WorkbenchViewport,
  policy: WorkbenchWindowGeometryPolicy,
): WorkbenchWindowGeometry {
  const bounds = readGeometryBounds(viewport, policy.inset);
  const width = clamp(geometry.width, Math.min(policy.minWidth, bounds.width), bounds.width);
  const height = clamp(geometry.height, Math.min(policy.minHeight, bounds.height), bounds.height);
  return {
    x: clamp(geometry.x, bounds.left, bounds.right - width),
    y: clamp(geometry.y, bounds.top, bounds.bottom - height),
    width,
    height,
  };
}

export function createMaximizedWindowGeometry(
  viewport: WorkbenchViewport,
  policy: WorkbenchWindowGeometryPolicy,
  compact: boolean,
): WorkbenchWindowGeometry {
  const bounds = readGeometryBounds(viewport, compact ? policy.compactInset : policy.inset);
  return { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height };
}

export function createCollapsedWindowGeometry(
  geometry: WorkbenchWindowGeometry,
  viewport: WorkbenchViewport,
  policy: WorkbenchWindowGeometryPolicy,
): WorkbenchWindowGeometry {
  const bounds = readGeometryBounds(viewport, policy.inset);
  const width = Math.min(policy.collapsedWidth, bounds.width);
  const height = Math.min(policy.titlebarHeight, bounds.height);
  return {
    x: clamp(geometry.x, bounds.left, bounds.right - width),
    y: clamp(geometry.y, bounds.top, bounds.bottom - height),
    width,
    height,
  };
}

export function readPersistedWindowGeometry(value: unknown): WorkbenchWindowGeometry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<Record<keyof WorkbenchWindowGeometry, unknown>>;
  const values = [candidate.x, candidate.y, candidate.width, candidate.height];
  if (!values.every(isFiniteNumber)) return undefined;
  const [x, y, width, height] = values as number[];
  return width > 0 && height > 0 ? { x, y, width, height } : undefined;
}

function readGeometryBounds(viewport: WorkbenchViewport, inset: number) {
  const width = Math.max(1, finiteOr(viewport.width, 1));
  const height = Math.max(1, finiteOr(viewport.height, 1));
  const safeInset = clamp(finiteOr(inset, 0), 0, Math.max(0, Math.min(width, height) / 2));
  const right = Math.max(safeInset + 1, width - safeInset);
  const bottom = Math.max(safeInset + 1, height - safeInset);
  return {
    left: safeInset,
    top: safeInset,
    right,
    bottom,
    width: right - safeInset,
    height: bottom - safeInset,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  const safeMaximum = Math.max(minimum, maximum);
  return Math.min(safeMaximum, Math.max(minimum, finiteOr(value, minimum)));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
