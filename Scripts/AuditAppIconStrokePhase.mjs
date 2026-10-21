/**
 * Stroke-phase audit for the AppIcon catalog.
 *
 * Why this exists: an icon rendered at a non-viewBox size lands on a pixel grid
 * it was never drawn for. An axis-aligned stroke whose painted span does not
 * start and end on integer pixel boundaries is spread across two pixel rows at
 * partial opacity, so it reads thinner and greyer than a neighbour whose span
 * happens to align. Nominal `stroke-width` is identical in both cases — the
 * difference is pixel phase, not weight.
 *
 * For a stroke of width `w` pixels whose painted span starts at `e`:
 *   peak = max over pixel rows of (overlap between that row and [e, e + w])
 *   concentration = peak / min(w, 1)
 *
 * The `min(w, 1)` divisor is what makes the number comparable across sizes. A
 * stroke wider than a pixel can reach `peak === 1` by fully covering a row, but
 * one narrower than a pixel cannot: it tops out at `peak === w` by sitting
 * entirely inside a single row. Dividing by `min(w, 1)` maps both cases onto
 * 0..1, where 1 means "as concentrated as this width allows" — the stroke reads
 * at its nominal weight instead of being smeared thinner across two rows.
 *
 * Scope: only axis-aligned straight runs are measured (H/V/L segments, `line`,
 * and `rect` edges). Diagonal and curved strokes cannot be brought to full
 * concentration at any sane width, so they are out of scope rather than
 * silently averaged in.
 *
 * Usage (the `--tsconfig` flag is required: the Frontend owns the jsx settings,
 * and without it tsx emits the classic runtime and React throws at render):
 *   npx tsx --tsconfig Frontend/tsconfig.json Scripts/AuditAppIconStrokePhase.mjs
 *   ... --width-sweep      does a heavier stroke buy phase tolerance?
 *   ... --can-align        can this library be clean at each size at all?
 *   ... --size-sweep       best single size by phase coverage
 *   ... --adaptive <px>    re-derive stroke width per size for a constant painted width
 *   ... --usage            how many <AppIcon> elements each render size receives
 *   ... --icon minus --all per-run detail for one icon, every offender
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { AppIcon } = await import("../Frontend/src/shared/ui/AppIcon.tsx");

const VIEW_BOX = 24;
// Resolve from this file, not from the working directory: the audit is imported
// by tests and run from both the repo root and the Frontend workspace.
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_SOURCE = path.join(SCRIPT_DIR, "..", "Frontend", "src", "shared", "ui", "AppIcon.tsx");

const PATH_COMMAND_ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

export function readCatalogNames() {
  const source = readFileSync(CATALOG_SOURCE, "utf8");
  const body = source.slice(source.indexOf("const AppIconCatalog = {"), source.indexOf("} as const;"));
  return [...body.matchAll(/^ {2}(?:"([^"]+)"|([A-Za-z][\w-]*)):/gm)].map((match) => match[1] ?? match[2]);
}

export function tokenizePath(data) {
  const tokens = [];
  const pattern = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/g;
  let match;
  while ((match = pattern.exec(data)) !== null) {
    tokens.push(match[1] ? { command: match[1] } : { number: Number.parseFloat(match[2]) });
  }
  return tokens;
}

/**
 * Returns every straight run as `[axis, coordinate]`, where `axis` is `x` for a
 * vertical run and `y` for a horizontal run, and `coordinate` is the stroke
 * centreline position in viewBox units. Curves and diagonals are skipped.
 */
export function straightRuns(data) {
  const tokens = tokenizePath(data);
  const runs = [];
  let index = 0;
  let command = null;
  let firstOfCommand = true;
  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;

  while (index < tokens.length) {
    if (tokens[index].command !== undefined) {
      command = tokens[index].command;
      firstOfCommand = true;
      index += 1;
      if (command === "Z" || command === "z") {
        currentX = startX;
        currentY = startY;
        continue;
      }
    }
    if (command === null) {
      index += 1;
      continue;
    }

    // A moveto only moves on its first pair; later pairs are implicit linetos.
    let effective = command;
    if (!firstOfCommand && (command === "M" || command === "m")) {
      effective = command === "M" ? "L" : "l";
    }
    firstOfCommand = false;

    const upper = effective.toUpperCase();
    const relative = effective !== upper;
    const arity = PATH_COMMAND_ARITY[upper];
    const args = [];
    let complete = true;
    for (let offset = 0; offset < arity; offset += 1) {
      const token = tokens[index + offset];
      if (token === undefined || token.number === undefined) {
        complete = false;
        break;
      }
      args.push(token.number);
    }
    if (!complete) {
      command = null;
      continue;
    }
    index += arity;

    switch (upper) {
      case "M":
      case "L": {
        const x = relative ? currentX + args[0] : args[0];
        const y = relative ? currentY + args[1] : args[1];
        if (upper === "L") {
          if (y === currentY && x !== currentX) runs.push(["y", y]);
          else if (x === currentX && y !== currentY) runs.push(["x", x]);
        }
        if (upper === "M") {
          startX = x;
          startY = y;
        }
        currentX = x;
        currentY = y;
        break;
      }
      case "H": {
        const x = relative ? currentX + args[0] : args[0];
        if (x !== currentX) runs.push(["y", currentY]);
        currentX = x;
        break;
      }
      case "V": {
        const y = relative ? currentY + args[0] : args[0];
        if (y !== currentY) runs.push(["x", currentX]);
        currentY = y;
        break;
      }
      case "C":
        currentX = relative ? currentX + args[4] : args[4];
        currentY = relative ? currentY + args[5] : args[5];
        break;
      case "S":
      case "Q":
        currentX = relative ? currentX + args[2] : args[2];
        currentY = relative ? currentY + args[3] : args[3];
        break;
      case "T":
        currentX = relative ? currentX + args[0] : args[0];
        currentY = relative ? currentY + args[1] : args[1];
        break;
      case "A":
        currentX = relative ? currentX + args[5] : args[5];
        currentY = relative ? currentY + args[6] : args[6];
        break;
      default:
        break;
    }
  }
  return runs;
}

function attribute(markup, name) {
  const match = markup.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? Number.parseFloat(match[1]) : undefined;
}

/** Every axis-aligned straight run in one rendered icon, as `[axis, coordinate]`. */
export function collectStraightRuns(markup) {
  const runs = [];
  for (const match of markup.matchAll(/<path\b[^>]*\bd="([^"]*)"/g)) {
    runs.push(...straightRuns(match[1]));
  }
  for (const match of markup.matchAll(/<line\b[^>]*>/g)) {
    const tag = match[0];
    const x1 = attribute(tag, "x1");
    const x2 = attribute(tag, "x2");
    const y1 = attribute(tag, "y1");
    const y2 = attribute(tag, "y2");
    if (y1 === y2 && x1 !== x2) runs.push(["y", y1]);
    else if (x1 === x2 && y1 !== y2) runs.push(["x", x1]);
  }
  for (const match of markup.matchAll(/<rect\b[^>]*>/g)) {
    const tag = match[0];
    const x = attribute(tag, "x") ?? 0;
    const y = attribute(tag, "y") ?? 0;
    const width = attribute(tag, "width") ?? 0;
    const height = attribute(tag, "height") ?? 0;
    runs.push(["y", y], ["y", y + height], ["x", x], ["x", x + width]);
  }
  // `<circle>` has no straight run; every point of it is a curve.
  return runs;
}

/** Pixel rows the painted span `[start, start + width]` touches, with coverage. */
export function pixelCoverage(start, width) {
  const rows = [];
  const first = Math.floor(start);
  const last = Math.floor(start + width);
  for (let row = first; row <= last; row += 1) {
    const overlap = Math.min(start + width, row + 1) - Math.max(start, row);
    if (overlap > 0) rows.push(Math.min(overlap, 1));
  }
  return rows;
}

export function measure(runs, size, strokeWidth) {
  const scale = size / VIEW_BOX;
  const strokePixels = strokeWidth * scale;
  // A stroke narrower than one pixel cannot reach peak 1; normalise by what it
  // can reach so the number means the same thing at every size.
  const reachable = Math.min(strokePixels, 1);
  let worstConcentration = 1;
  const rows = [];
  for (const [, coordinate] of runs) {
    const centre = coordinate * scale;
    const coverage = pixelCoverage(centre - strokePixels / 2, strokePixels);
    const peak = Math.max(...coverage);
    const solid = coverage.filter((value) => value >= 0.999).length;
    const concentration = peak / reachable;
    rows.push({ coordinate, centre, peak, concentration, solid });
    worstConcentration = Math.min(worstConcentration, concentration);
  }
  return { strokePixels, worstConcentration, rows };
}

/** Stroke width in viewBox units that paints `pixels` device pixels at `size`. */
export function strokeWidthForPixels(size, pixels) {
  return pixels / (size / VIEW_BOX);
}

/**
 * Fractional centreline positions that this stroke width can still resolve.
 *
 * The window inverts around 1px, which is the non-obvious part:
 *  - `w >= 1`: the span must fully cover some row, so a whole-number unit
 *    boundary has to fall inside it. Good fractions wrap around 0, and the
 *    window is `w - 1` wide.
 *  - `w < 1`: the span must cross no boundary at all, so it has to sit inside a
 *    single row. Good fractions gather around 0.5, and the window is `1 - w`
 *    wide.
 *
 * So a hairline can only be phase-clean when it is centred *between* pixel
 * boundaries, while a fat stroke can only be phase-clean when it is centred
 * *on* one. Tolerance grows with weight either way — `w` and tolerance are the
 * same dial, which is why "just use a heavier stroke" is not a free fix.
 */
export function phaseWindow(strokePixels) {
  if (strokePixels <= 1) {
    return { low: strokePixels / 2, high: 1 - strokePixels / 2, width: 1 - strokePixels, centeredOn: 0.5 };
  }
  return { low: 1 - strokePixels / 2, high: strokePixels / 2, width: strokePixels - 1, centeredOn: 0 };
}

/**
 * Where whole-number viewBox units land, modulo one pixel, at a given size.
 *
 * Heroicons authors every coordinate as a whole number, so this set is the
 * entire phase vocabulary the catalog has at that size. Comparing it against
 * `phaseWindow` answers "can any icon in this library be phase-clean here?" —
 * if the two sets do not intersect, the answer is no for every icon, and no
 * amount of per-icon tuning can rescue it.
 */
export function integerPhaseSet(size, strokePixels) {
  const scale = size / VIEW_BOX;
  const window = phaseWindow(strokePixels);
  const seen = new Map();
  for (let unit = 0; unit <= VIEW_BOX; unit += 1) {
    const centre = unit * scale;
    const fraction = centre - Math.floor(centre);
    const inWindow =
      window.low <= window.high
        ? fraction >= window.low && fraction <= window.high
        : fraction >= window.low || fraction <= window.high;
    const key = fraction.toFixed(4);
    if (!seen.has(key)) seen.set(key, { fraction, inWindow });
  }
  return { window, fractions: [...seen.values()].sort((a, b) => a.fraction - b.fraction) };
}

const SIZES = [12, 13, 14, 15, 16, 17, 18, 20, 24];

/** Sizes worth considering as an enforced single size, ranked by phase coverage. */
const CANDIDATE_SIZES = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 28, 30, 32];

export function sweepSizeCoverage(strokeWidth) {
  const rows = [];
  for (const size of CANDIDATE_SIZES) {
    const strokePixels = strokeWidth * (size / VIEW_BOX);
    const { window, fractions } = integerPhaseSet(size, strokePixels);
    const aligned = fractions.filter((entry) => entry.inWindow).length;
    rows.push({
      size,
      strokePixels,
      window,
      total: fractions.length,
      aligned,
      ratio: aligned / fractions.length,
    });
  }
  return rows.sort((a, b) => b.ratio - a.ratio || a.size - b.size);
}

/** How many of this icon's straight runs fully align at `size`. Higher is better. */
export function scoreIcon(runs, size, strokeWidth) {
  const result = measure(runs, size, strokeWidth);
  return result.rows.filter((cell) => cell.concentration >= 0.999).length;
}

/** Renders the whole catalog once and returns each icon's straight runs. */
export function loadCatalog() {
  const names = readCatalogNames();
  const entries = [];
  let strokeWidth = 0;
  for (const name of names) {
    const markup = renderToStaticMarkup(React.createElement(AppIcon, { icon: name, size: VIEW_BOX }));
    strokeWidth = attribute(markup, "stroke-width") ?? strokeWidth;
    const runs = collectStraightRuns(markup);
    if (runs.length > 0) entries.push({ name, runs });
  }
  return { names, entries, strokeWidth };
}

/** Per-size alignment summary for the whole catalog. */
export function summarize(entries, sizes, resolveStrokeWidth) {
  return sizes.map((size) => {
    const strokeWidth = resolveStrokeWidth(size);
    const measured = entries.map((entry) => ({ name: entry.name, ...measure(entry.runs, size, strokeWidth) }));
    const aligned = measured.filter((entry) => entry.worstConcentration >= 0.999);
    return { size, strokeWidth, aligned, measured, strokePixels: measured[0]?.strokePixels ?? 0 };
  });
}

function walkSourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) files.push(...walkSourceFiles(full));
    else if (/\.tsx?$/.test(full)) files.push(full);
  }
  return files;
}

/**
 * Every render size `<AppIcon>` actually receives in `Frontend/src`.
 *
 * The Story's `productionSizes` table is derived from this rather than
 * maintained by hand, so a new size in feature code shows up in the visual
 * review instead of silently missing from it.
 *
 * `tailwindPixels` maps the fixed-pixel `className` spellings onto the sizes
 * they are equivalent to, because those bypass the `size` prop entirely.
 */
export function readSizeUsage() {
  const tailwindPixels = { "h-3 w-3": 12, "h-3.5 w-3.5": 14, "h-4 w-4": 16, "h-5 w-5": 20, "h-6 w-6": 24 };
  const counts = new Map();
  const bySpelling = [];
  let total = 0;
  let implicit = 0;
  for (const file of walkSourceFiles(path.join(SCRIPT_DIR, "..", "Frontend", "src"))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/<AppIcon\b[\s\S]*?(?:\/>|>)/g)) {
      total += 1;
      const element = match[0];
      const prop = element.match(/\bsize=\{(\d+)\}|\bsize="(\d+)"/);
      if (prop) {
        const size = Number(prop[1] ?? prop[2]);
        counts.set(size, (counts.get(size) ?? 0) + 1);
        bySpelling.push({ size, spelling: `size={${size}}`, count: 1 });
        continue;
      }
      const className = element.match(/className="([^"]*)"/);
      const spelling =
        className === null ? undefined : Object.keys(tailwindPixels).find((key) => className[1].includes(key));
      if (spelling === undefined) {
        // No prop and no known fixed-pixel class: the caller relies on the
        // component default, so the size is whatever AppIcon defaults to.
        implicit += 1;
        continue;
      }
      const size = tailwindPixels[spelling];
      counts.set(size, (counts.get(size) ?? 0) + 1);
      bySpelling.push({ size, spelling: `className="${spelling}"`, count: 1 });
    }
  }
  const sizes = [...counts.entries()]
    .map(([size, count]) => ({ size, count }))
    .sort((a, b) => b.count - a.count || a.size - b.size);
  const merged = new Map();
  for (const { size, spelling } of bySpelling) {
    const key = `${size}|${spelling}`;
    merged.set(key, { size, spelling, count: (merged.get(key)?.count ?? 0) + 1 });
  }
  return {
    sizes,
    bySpelling: [...merged.values()].sort((a, b) => b.count - a.count || a.size - b.size),
    total,
    implicit,
  };
}

function main() {
  const iconFilter = process.argv.includes("--icon") ? process.argv[process.argv.indexOf("--icon") + 1] : undefined;
  const showAll = process.argv.includes("--all");
  const strokeOverride = process.argv.includes("--stroke-width")
    ? Number.parseFloat(process.argv[process.argv.indexOf("--stroke-width") + 1])
    : undefined;
  const adaptivePixels = process.argv.includes("--adaptive")
    ? Number.parseFloat(process.argv[process.argv.indexOf("--adaptive") + 1])
    : undefined;

  const { names, entries, strokeWidth: catalogStrokeWidth } = loadCatalog();
  let strokeWidth = catalogStrokeWidth;
  if (strokeOverride !== undefined) strokeWidth = strokeOverride;
  const resolveStrokeWidth =
    adaptivePixels === undefined ? () => strokeWidth : (size) => strokeWidthForPixels(size, adaptivePixels);

  console.log(`Catalog: ${names.length} icons; ${entries.length} have an axis-aligned straight run.`);
  if (adaptivePixels === undefined) {
    console.log(`Effective stroke-width: ${strokeWidth} viewBox units.`);
  } else {
    console.log(`Adaptive stroke width: ${adaptivePixels}px painted at every size.`);
  }
  console.log();

  if (process.argv.includes("--width-sweep")) {
    console.log("=== Does a wider stroke buy phase tolerance? ===");
    console.log("(16px render, centreline swept across one pixel in 0.05px steps)");
    console.log("width_units  width_px  phase_window_px  worst_concentration  verdict");
    for (const candidate of [1.5, 1.75, 2, 2.25, 2.5, 3]) {
      const strokePixels = candidate * (16 / VIEW_BOX);
      const window = phaseWindow(strokePixels);
      let worst = 1;
      for (let step = 0; step <= 20; step += 1) {
        const centre = 8 + (step / 20) * 1;
        const coverage = pixelCoverage(centre - strokePixels / 2, strokePixels);
        worst = Math.min(worst, Math.max(...coverage) / Math.min(strokePixels, 1));
      }
      console.log(
        `${candidate.toFixed(2).padStart(11)}  ${strokePixels.toFixed(4).padStart(8)}  ${window.width.toFixed(4).padStart(15)}  ${worst.toFixed(3).padStart(19)}  ${worst >= 0.999 ? "tolerant" : "still sensitive"}`,
      );
    }
    console.log();
  }

  if (process.argv.includes("--can-align")) {
    console.log("=== Can this library be phase-clean at each size? ===");
    console.log("(Heroicons authors whole-number units, so these are the only phases available)");
    console.log();
    console.log("size   stroke_px   phase_window      unit_fractions                       verdict");
    for (const size of SIZES) {
      const strokePixels = resolveStrokeWidth(size) * (size / VIEW_BOX);
      const { window, fractions } = integerPhaseSet(size, strokePixels);
      const reachable = fractions.filter((entry) => entry.inWindow);
      const sample = fractions
        .slice(0, 5)
        .map((entry) => entry.fraction.toFixed(2))
        .join(" ");
      const verdict =
        reachable.length === fractions.length
          ? "every unit aligns"
          : reachable.length > 0
            ? `${reachable.length}/${fractions.length} units align`
            : "NO unit aligns";
      console.log(
        `${String(size).padStart(4)}   ${strokePixels.toFixed(4).padStart(9)}   [${window.low.toFixed(2)}..${window.high.toFixed(2)}]    {${sample} ...}   ${verdict}`,
      );
    }
    console.log();
  }

  if (process.argv.includes("--size-sweep")) {
    console.log("=== Best single size to standardise on, by phase coverage ===");
    console.log("(an icon only survives if EVERY one of its axis-aligned strokes aligns)");
    console.log();
    console.log("rank  size   stroke_px   aligned_units   coverage");
    const ranked = sweepSizeCoverage(strokeWidth);
    for (const [index, row] of ranked.slice(0, 12).entries()) {
      console.log(
        `${String(index + 1).padStart(4)}  ${String(row.size).padStart(4)}   ${row.strokePixels.toFixed(4).padStart(9)}   ${`${row.aligned}/${row.total}`.padStart(13)}   ${(row.ratio * 100).toFixed(0).padStart(6)}%`,
      );
    }
    console.log();

    // Coverage of unit values is necessary but not sufficient: an icon needs
    // every stroke it contains to land in the window, so check the real catalog.
    const measured = entries.map((entry) => {
      const best = ranked.reduce((top, row) =>
        scoreIcon(entry.runs, row.size, strokeWidth) > scoreIcon(entry.runs, top.size, strokeWidth) ? row : top,
      );
      return { name: entry.name, best: best.size };
    });
    console.log("Per-icon best size across the catalog (top 3 sizes by count):");
    const bySize = new Map();
    for (const entry of measured) bySize.set(entry.best, (bySize.get(entry.best) ?? 0) + 1);
    for (const [size, count] of [...bySize.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
      console.log(`  ${String(size).padStart(3)}px: ${count} icons`);
    }
    console.log();
  }

  if (process.argv.includes("--usage")) {
    const usage = readSizeUsage();
    const spellings = new Map();
    for (const { size, spelling, count } of usage.bySpelling) {
      if (!spellings.has(size)) spellings.set(size, []);
      spellings.get(size).push(`${spelling}×${count}`);
    }
    console.log("=== Render sizes `<AppIcon>` actually receives in Frontend/src ===");
    console.log();
    console.log("size   count   spellings");
    for (const { size, count } of usage.sizes) {
      console.log(`${String(size).padStart(4)}   ${String(count).padStart(5)}   ${spellings.get(size).join(", ")}`);
    }
    console.log();
    console.log(`Total <AppIcon> elements: ${usage.total}; relying on the component default: ${usage.implicit}`);
    console.log();
    console.log("Story table (paste into AppIcon.stories.tsx `productionSizes`):");
    console.log(`  ${usage.sizes.map(({ size, count }) => `{ size: ${size}, count: ${count} }`).join(", ")}`);
    console.log();
  }

  const summary = summarize(entries, SIZES, resolveStrokeWidth);

  console.log("=== Phase summary across the sizes production uses ===");
  console.log("(aligned = every axis-aligned stroke in that icon reads at nominal weight)");
  console.log();
  console.log("size   stroke_units   stroke_px   phase_window_px   icons   aligned   aligned%");
  for (const row of summary) {
    const window = phaseWindow(row.strokePixels);
    const percent = ((row.aligned.length / row.measured.length) * 100).toFixed(0);
    console.log(
      `${String(row.size).padStart(4)}   ${row.strokeWidth.toFixed(3).padStart(12)}   ${row.strokePixels.toFixed(4).padStart(9)}   ${window.width.toFixed(4).padStart(15)}   ${String(row.measured.length).padStart(5)}   ${String(row.aligned.length).padStart(7)}   ${percent.padStart(7)}%`,
    );
  }
  console.log();

  for (const row of summary) {
    const offenders = row.measured
      .filter((entry) => entry.worstConcentration < 0.999)
      .sort((a, b) => a.worstConcentration - b.worstConcentration);
    if (offenders.length === 0) {
      console.log(`=== ${row.size}px: every axis-aligned stroke is aligned ===`);
      console.log();
      continue;
    }
    console.log(`=== ${row.size}px: ${offenders.length} icons below nominal weight (worst first) ===`);
    const listed = showAll ? offenders : offenders.slice(0, 12);
    for (const offender of listed) {
      const worst = offender.rows.reduce((lowest, cell) => (cell.peak < lowest.peak ? cell : lowest), offender.rows[0]);
      console.log(
        `  ${offender.name.padEnd(22)} concentration ${offender.worstConcentration.toFixed(3)}  at ${worst.coordinate} units -> ${worst.centre.toFixed(3)}px`,
      );
    }
    if (!showAll && listed.length < offenders.length) {
      console.log(`  ... and ${offenders.length - listed.length} more (pass --all to list every icon)`);
    }
    console.log();
  }

  if (iconFilter !== undefined) {
    const target = entries.find((entry) => entry.name === iconFilter);
    if (target === undefined) {
      console.log(`--icon ${iconFilter}: no axis-aligned straight run.`);
      return;
    }
    console.log(`=== ${iconFilter} per size ===`);
    console.log("size   centre_px   stroke_px   peak    concentration   solid_rows");
    for (const size of SIZES) {
      const result = measure(target.runs, size, resolveStrokeWidth(size));
      for (const cell of result.rows) {
        console.log(
          `${String(size).padStart(4)}   ${cell.centre.toFixed(3).padStart(9)}   ${result.strokePixels.toFixed(4).padStart(9)}   ${cell.peak.toFixed(3)}   ${cell.concentration.toFixed(3).padStart(13)}   ${String(cell.solid).padStart(10)}`,
        );
      }
    }
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
