import { RealRuntimeIntegrationValues } from "../../../Dist/Scripts/IntegrationTests/RuntimeIntegration/RealRuntimeIntegrationHarness.js";
import { createBrowserE2eHarness, expect, test } from "../browserE2eTest.mjs";

let harness;

test.describe.configure({ mode: "serial" });

/**
 * Frame-level contract for the pointer-following highlight. jsdom has no
 * animation frames, no layout and no ResizeObserver timing, so the hover layer
 * is only observable here: every assertion below is read from the DOM inside a
 * `requestAnimationFrame` callback while real pointer events are delivered.
 */
test.describe("fluid hover layer frames", () => {
  test.beforeAll(async () => {
    harness = await createBrowserE2eHarness({ authenticationMode: "disabled" });
  });

  test.afterAll(async () => {
    await harness?.stop();
  });

  test("keeps one highlight layer through hover, click, relayout and re-entry", async ({ page }) => {
    await page.addInitScript(installFrameRecorder);

    const readRows = () =>
      page.locator("[data-session-row]").evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            id: node.getAttribute("data-session-row"),
            x: rect.x,
            y: rect.y,
            w: rect.width,
            h: rect.height,
            cx: rect.x + rect.width / 2,
            cy: rect.y + rect.height / 2,
          };
        }),
      );
    const rowById = async (id) => (await readRows()).find((row) => row.id === id);
    const setMotionLevel = async (from, to) => {
      await page.goto(`${harness.httpOrigin}/settings/general`);
      const workbench = page.locator("[data-settings-workbench]");
      await workbench.waitFor();
      await workbench.getByRole("button", { name: new RegExp(`${from}$`) }).click();
      await page.getByRole("menuitem", { name: new RegExp(`^${to}`) }).click();
      await page.getByRole("button", { name: "关闭设置" }).click();
      await page.locator("[data-session-row]").first().waitFor();
    };
    const record = async (run) => {
      await page.evaluate(() => window.__fluidHoverFrames.start());
      await run();
      await page.waitForTimeout(400);
      return page.evaluate(() => window.__fluidHoverFrames.stop());
    };

    await page.goto(harness.httpOrigin);
    const composer = page.getByLabel("输入消息");
    await composer.waitFor();

    // A fresh session is reused while it stays empty, so each extra row needs
    // one real turn before the next "new session" click creates another row.
    for (let index = 0; index < 3; index += 1) {
      await page
        .locator("[data-session-sidebar]:visible")
        .locator("[data-session-header]")
        .getByRole("button", { name: "新建对话" })
        .click();
      await composer.fill(RealRuntimeIntegrationValues.DirectRequestInput);
      await composer.press("Enter");
      await expect(
        page.locator("[data-assistant-message]").filter({ hasText: RealRuntimeIntegrationValues.DirectFinalAnswer }),
      ).toBeVisible({ timeout: 45_000 });
    }

    await expect.poll(() => page.locator("[data-session-row]").count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(3);
    const selectedRowId = await page
      .locator("[data-active-session-indicator]")
      .first()
      .evaluate((node) => node.closest("[data-session-row]")?.getAttribute("data-session-row") ?? null);
    const unselected = (await readRows()).filter((row) => row.id !== selectedRowId);
    expect(unselected.length).toBeGreaterThanOrEqual(2);
    const [firstId, secondId] = [unselected[0].id, unselected[1].id];

    const report = {};

    // Pointer travels between two unselected rows, then the list relayouts.
    await page.mouse.move(unselected[1].cx, unselected[1].cy);
    await page.waitForTimeout(400);
    report.hover = summarize(
      await record(async () => {
        await page.mouse.move(unselected[0].cx, unselected[0].cy, { steps: 12 });
      }),
      await readRows(),
    );
    report.relayout = summarize(
      await record(async () => {
        await page.setViewportSize({ width: 1280, height: 800 });
      }),
      [],
    );

    // A single pointer jump between rows, at full and at reduced motion.
    const jump = async (fromId, toId) => {
      const from = await rowById(fromId);
      const to = await rowById(toId);
      await page.mouse.move(from.cx, from.cy);
      await page.waitForTimeout(250);
      const samples = await record(async () => {
        await page.mouse.move(to.cx, to.cy);
      });
      return summarize(samples, await readRows(), to);
    };
    report.fullJump = await jump(firstId, secondId);
    await setMotionLevel("完整", "轻量");
    report.reducedJump = await jump(secondId, firstId);

    // Motion off must not paint a hover layer at all.
    await setMotionLevel("轻量", "关闭");
    const offRow = await rowById(firstId);
    report.motionOff = summarize(
      await record(async () => {
        await page.mouse.move(offRow.cx, offRow.cy, { steps: 4 });
      }),
      await readRows(),
    );
    await setMotionLevel("关闭", "完整");

    // Clicking the hovered row moves the selection under the pointer.
    const clickRow = await rowById(firstId);
    report.click = summarize(
      await record(async () => {
        await page.mouse.move(clickRow.cx, clickRow.cy, { steps: 6 });
        await page.mouse.click(clickRow.cx, clickRow.cy);
      }),
      await readRows(),
    );
    await expect(page.locator(`[data-session-row="${firstId}"] [data-active-session-indicator]`)).toBeVisible();

    // Leaving and re-entering the list repeatedly must not stack two layers.
    const reentryRow = await rowById(secondId);
    const above = { cx: reentryRow.cx, cy: Math.max(reentryRow.cy - 140, 30) };
    report.reentry = summarize(
      await record(async () => {
        for (let index = 0; index < 3; index += 1) {
          await page.mouse.move(above.cx, above.cy, { steps: 2 });
          await page.waitForTimeout(25);
          await page.mouse.move(reentryRow.cx, reentryRow.cy, { steps: 2 });
          await page.waitForTimeout(25);
        }
      }),
      await readRows(),
    );

    // Settings navigation owns a layoutId indicator on the same rows.
    await page.goto(`${harness.httpOrigin}/settings/model-service`);
    await page.locator("[data-settings-workbench]").waitFor();
    const navRects = await page
      .getByLabel("设置分区")
      .getByRole("button")
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            selected: node.getAttribute("aria-current") === "page",
            x: rect.x,
            y: rect.y,
            w: rect.width,
            h: rect.height,
            cx: rect.x + rect.width / 2,
            cy: rect.y + rect.height / 2,
          };
        }),
      );
    const navTarget = navRects.find((entry) => !entry.selected);
    expect(navTarget).toBeTruthy();
    await page.mouse.move(navTarget.cx, navTarget.cy, { steps: 4 });
    await page.waitForTimeout(300);
    report.settingsNavigation = summarize(
      await record(async () => {
        await page.mouse.click(navTarget.cx, navTarget.cy);
      }),
      navRects,
    );

    console.log(`FLUID_HOVER_FRAMES ${JSON.stringify(report)}`);

    // The pointer settles on a row: the layer exists, is unique and lands there.
    expect(report.hover.blinkFrames).toBe(0);
    expect(report.hover.duplicateFrames).toBe(0);
    expect(report.hover.settledDeltaY).toBe(0);
    // A remeasure is a retarget, not a teardown.
    expect(report.relayout.blinkFrames).toBe(0);
    expect(report.relayout.fadedFrames).toBe(0);
    // Full motion springs onto the row the pointer moved to.
    expect(report.fullJump.layeredOverRowFrames).toBeGreaterThan(0);
    expect(report.fullJump.settledDeltaY).toBe(0);
    expect(report.fullJump.settleFrames).toBeGreaterThanOrEqual(2);
    expect(report.fullJump.travelFrames).toBeGreaterThanOrEqual(1);
    // Reduced motion keeps the same single layer and retargets within a frame.
    expect(report.reducedJump.duplicateFrames).toBe(0);
    expect(report.reducedJump.settledDeltaY).toBe(0);
    expect(report.reducedJump.settleFrames).toBeLessThanOrEqual(2);
    expect(report.reducedJump.travelFrames).toBe(0);
    // Motion off paints nothing, the row keeps its CSS hover only.
    expect(report.motionOff.layeredOverRowFrames).toBe(0);
    // Selection owns the surface of the row it lands on.
    expect(report.click.doublePaintFrames).toBe(0);
    expect(report.click.duplicateFrames).toBe(0);
    // Re-entry remounts a single layer instead of crossfading two.
    expect(report.reentry.duplicateFrames).toBe(0);
    // Selecting a settings section keeps one layer and no half-faded ghost.
    expect(report.settingsNavigation.duplicateFrames).toBe(0);
    expect(report.settingsNavigation.doublePaintFrames).toBe(0);
    expect(report.settingsNavigation.fadedFrames).toBe(0);
  });
});

function installFrameRecorder() {
  const state = { recording: false, samples: [], raf: 0, last: 0, point: null };
  window.__fluidHoverFrames = state;

  const remember = (event) => {
    state.point = { x: event.clientX, y: event.clientY };
  };
  window.addEventListener("pointermove", remember, true);
  window.addEventListener("mousemove", remember, true);

  const tick = () => {
    const now = performance.now();
    const boxes = Array.from(document.querySelectorAll("[data-fluid-hover-highlight]")).map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        w: rect.width,
        h: rect.height,
        opacity: Number(getComputedStyle(node).opacity),
      };
    });
    const indicator = document.querySelector(
      "[data-active-session-indicator], [data-settings-navigation-indicator], [data-provider-selection-indicator]",
    );
    const indicatorRect = indicator ? indicator.getBoundingClientRect() : null;
    state.samples.push({
      t: now,
      dt: now - state.last,
      boxes,
      point: state.point,
      indicator: indicatorRect
        ? { x: indicatorRect.x, y: indicatorRect.y, w: indicatorRect.width, h: indicatorRect.height }
        : null,
    });
    state.last = now;
    if (state.recording) state.raf = requestAnimationFrame(tick);
  };
  state.start = () => {
    state.samples = [];
    state.last = performance.now();
    state.recording = true;
    state.raf = requestAnimationFrame(tick);
  };
  state.stop = () => {
    state.recording = false;
    cancelAnimationFrame(state.raf);
    return state.samples;
  };
}

function contains(rect, point) {
  return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
}

function overlapRatio(box, indicator) {
  const width = Math.min(box.x + box.w, indicator.x + indicator.w) - Math.max(box.x, indicator.x);
  const height = Math.min(box.y + box.h, indicator.y + indicator.h) - Math.max(box.y, indicator.y);
  const intersection = Math.max(width, 0) * Math.max(height, 0);
  const area = Math.min(box.w * box.h, indicator.w * indicator.h);
  return area > 0 ? intersection / area : 0;
}

/**
 * Frames between the pointer entering the target row and the layer landing on
 * it: a spring needs several, an instant retarget needs at most one.
 */
function measureSettle(frames, target) {
  const entered = frames.findIndex((frame) => contains(target, frame.point));
  if (entered < 0) return null;
  for (let index = entered; index < frames.length; index += 1) {
    const boxes = frames[index].boxes;
    if (boxes.length === 1 && Math.abs(boxes[0].y - target.y) <= 1) return index - entered;
  }
  return null;
}

function summarize(samples, rows, target) {
  const frames = samples.filter((sample) => sample.point);
  const rowUnder = (frame) => rows.find((row) => contains(row, frame.point));
  const overSelectedRow = (frame) => Boolean(frame.indicator && contains(frame.indicator, frame.point));
  const opacities = frames.flatMap((frame) => frame.boxes.map((box) => box.opacity));
  const settled = frames[frames.length - 1] ?? { boxes: [], point: null };
  const settledRow = settled.point ? rowUnder(settled) : undefined;
  return {
    frames: frames.length,
    // The layer must exist whenever the pointer is over a row that does not own
    // the selection surface, and must never exist twice.
    blinkFrames: frames.filter((frame) => frame.boxes.length === 0 && rowUnder(frame) && !overSelectedRow(frame))
      .length,
    layeredOverRowFrames: frames.filter((frame) => frame.boxes.length > 0 && rowUnder(frame)).length,
    // Frames where the single layer sits off every row: full motion springs
    // across rows, reduced motion lands on a row within the same frame.
    travelFrames: frames.filter(
      (frame) => frame.boxes.length === 1 && !rows.some((row) => Math.abs(frame.boxes[0].y - row.y) <= 1),
    ).length,
    duplicateFrames: frames.filter((frame) => frame.boxes.length > 1).length,
    doublePaintFrames: frames.filter((frame) =>
      frame.boxes.some((box) => frame.indicator && overlapRatio(box, frame.indicator) > 0.5),
    ).length,
    fadedFrames: frames.filter((frame) => frame.boxes.some((box) => box.opacity < 0.99)).length,
    opacityRange: opacities.length ? [Math.min(...opacities), Math.max(...opacities)] : null,
    settledDeltaY: settled.boxes.length === 1 && settledRow ? Math.round(settled.boxes[0].y - settledRow.y) : null,
    settleFrames: target ? measureSettle(frames, target) : null,
    longFrames: frames.filter((frame) => frame.dt > 34).length,
  };
}
