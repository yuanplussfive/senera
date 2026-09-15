import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

const { pickNearest } = await import("../../../Frontend/src/shared/motion/useFluidHover.ts");

const FrontendSourceRoot = path.resolve(process.cwd(), "Frontend", "src");

/**
 * The hover layer paints exactly one background. A `bg-*` utility next to it in
 * `className` would race the default in the cascade (equal specificity, so the
 * stylesheet order decides) and silently replace the list's own surface.
 */
test("hover layers declare their surface through surfaceClassName", () => {
  const violations = [];
  let layers = 0;
  for (const file of sourceFiles(FrontendSourceRoot)) {
    const source = readFileSync(file, "utf8");
    for (const element of source.matchAll(/<FluidHoverHighlight\b[\s\S]*?\/>/gu)) {
      layers += 1;
      const withoutSurface = element[0].replace(/surfaceClassName="[^"]*"/gu, "");
      if (/\bbg-[^\s"{]+/u.test(withoutSurface)) {
        violations.push(path.relative(process.cwd(), file));
      }
    }
  }

  expect(violations).toEqual([]);
  expect(layers).toBeGreaterThanOrEqual(10);
});

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const target = path.join(directory, entry);
    if (statSync(target).isDirectory()) return sourceFiles(target);
    return target.endsWith(".tsx") ? [target] : [];
  });
}

const baseInput = {
  containerRect: { left: 0, top: 0, width: 200, height: 120 },
  layoutSize: { width: 200, height: 120 },
  scroll: { x: 0, y: 0 },
  border: { x: 0, y: 0 },
};

test("fluid hover prefers the item under the pointer", () => {
  expect(
    pickNearest({
      ...baseInput,
      axis: "y",
      point: { x: 20, y: 42 },
      rects: [
        { top: 8, left: 0, width: 200, height: 24 },
        { top: 40, left: 0, width: 200, height: 24 },
      ],
    }),
  ).toBe(1);
});

test("fluid hover resolves gaps to the nearest item and skips disabled items", () => {
  expect(
    pickNearest({
      ...baseInput,
      axis: "y",
      point: { x: 20, y: 34 },
      rects: [
        { top: 8, left: 0, width: 200, height: 20 },
        { top: 44, left: 0, width: 200, height: 20 },
      ],
      isDisabled: (index) => index === 0,
    }),
  ).toBe(1);
});

test("fluid hover supports horizontal and grid nearest-item resolution", () => {
  expect(
    pickNearest({
      ...baseInput,
      axis: "x",
      point: { x: 142, y: 10 },
      rects: [
        { top: 0, left: 0, width: 80, height: 40 },
        { top: 0, left: 100, width: 80, height: 40 },
      ],
    }),
  ).toBe(1);
  expect(
    pickNearest({
      ...baseInput,
      axis: "xy",
      point: { x: 150, y: 90 },
      rects: [
        { top: 0, left: 0, width: 80, height: 40 },
        { top: 60, left: 100, width: 80, height: 40 },
      ],
    }),
  ).toBe(1);
});
