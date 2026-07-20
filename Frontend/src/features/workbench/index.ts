export { FloatingWorkbenchWindow } from "./FloatingWorkbenchWindow";
export { useWorkbenchStore } from "./workbenchStore";
export type { WorkbenchWindowId } from "./workbenchStore";
export {
  clampWindowGeometry,
  createCollapsedWindowGeometry,
  createDefaultWindowGeometry,
  createMaximizedWindowGeometry,
  readPersistedWindowGeometry,
} from "./windowGeometry";
export type {
  WorkbenchViewport,
  WorkbenchWindowGeometry,
  WorkbenchWindowGeometryPolicy,
  WorkbenchWindowMode,
} from "./windowGeometry";
