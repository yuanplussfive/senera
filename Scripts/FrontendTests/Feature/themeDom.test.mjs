import { describe, expect, it, vi } from "vitest";
import {
  applyAppearanceSnapshotToDocument,
  runAppearanceTransition,
} from "../../../Frontend/src/shared/theme/themeDom.ts";
import { createAppearanceSnapshot } from "../../../Frontend/src/shared/theme/themeModel.ts";
function createDocumentMock() {
  const dataset = {};
  const classes = new Set();
  const styleValues = new Map();
  const root = {
    dataset,
    classList: {
      add: vi.fn((className) => classes.add(className)),
      remove: vi.fn((className) => classes.delete(className)),
      contains: (className) => classes.has(className),
    },
    style: {
      colorScheme: "",
      setProperty: vi.fn((key, value) => {
        styleValues.set(key, value);
      }),
      removeProperty: vi.fn((key) => {
        styleValues.delete(key);
      }),
    },
  };
  return {
    documentRef: { documentElement: root },
    root,
    styleValues,
  };
}
describe("themeDom", () => {
  it("applies appearance datasets and css variables to the document root", () => {
    const { documentRef, root, styleValues } = createDocumentMock();
    const snapshot = createAppearanceSnapshot({
      preference: {
        themeMode: "dark",
        colorScheme: "ocean",
        accentColor: "violet",
        fontFamily: "system",
        fontScale: "large",
      },
      systemTheme: "light",
    });
    applyAppearanceSnapshotToDocument(snapshot, documentRef);
    expect(root.dataset.theme).toBe("dark");
    expect(root.dataset.themePreference).toBe("dark");
    expect(root.dataset.colorScheme).toBe("ocean");
    expect(root.dataset.accentColor).toBe("violet");
    expect(root.dataset.fontFamily).toBe("system");
    expect(root.dataset.fontScale).toBe("large");
    expect(root.style.colorScheme).toBe("dark");
    expect(styleValues.get("--theme-font-scale")).toBe("1.08");
  });
  it("uses View Transition when available and motion is full", () => {
    const { documentRef } = createDocumentMock();
    const startViewTransition = vi.fn((apply) => {
      apply();
      return {};
    });
    documentRef.startViewTransition = startViewTransition;
    const apply = vi.fn();
    runAppearanceTransition(apply, { motionLevel: "full" }, documentRef);
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
  });
  it("skips animation entirely when motion is disabled", () => {
    const { documentRef, root } = createDocumentMock();
    const startViewTransition = vi.fn();
    documentRef.startViewTransition = startViewTransition;
    const apply = vi.fn();
    runAppearanceTransition(apply, { motionLevel: "none" }, documentRef);
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(root.classList.add).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
