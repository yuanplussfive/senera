import { expect, test } from "../browserE2eTest.mjs";
import { createWorkspaceHostHarness } from "../workspaceHostHarness.mjs";

let harness;
test.beforeEach(async () => {
  harness = await createWorkspaceHostHarness();
});
test.afterEach(async () => {
  await harness?.stop();
});

for (const mode of ["retry", "continue"]) {
  test(`failed request exposes ${mode} and removes the superseded notice across reload`, async ({ page }) => {
    const recoveries = [];
    page.on("websocket", (socket) => {
      socket.on("framereceived", ({ payload }) => {
        const event = JSON.parse(payload.toString());
        if (event.kind === "run.started" && event.data.recovery) recoveries.push(event.data.recovery);
      });
    });
    await page.goto(harness.httpOrigin);
    const composer = page.getByLabel("输入消息");
    await expect(composer).toBeEnabled();
    await composer.fill("你好");
    await composer.press("Enter");
    const notices = page.locator("[data-run-error]");
    await expect(notices).toHaveCount(1);
    await expect(notices.getByRole("button", { name: "重试", exact: true })).toBeVisible();
    await expect(notices.getByRole("button", { name: "继续", exact: true })).toBeVisible();
    await notices.locator(`[data-run-error-action="${mode}"]`).click();
    await expect.poll(() => recoveries.length).toBe(1);
    expect(recoveries[0].mode).toBe(mode);
    // The test endpoint is deliberately unavailable, so only the new failure remains.
    await expect(page.locator('[data-run-error][data-recovery-status="ready"]')).toHaveCount(1);
    await expect(notices).toHaveCount(1);
    await page.reload();
    await expect(composer).toBeEnabled();
    await expect(notices).toHaveCount(1);
    await expect(notices.getByRole("button", { name: "重试", exact: true })).toBeVisible();
    await expect(notices.getByRole("button", { name: "继续", exact: true })).toBeVisible();
  });
}
