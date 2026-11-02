import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  RealRuntimeIntegrationAdmin,
  RealRuntimeIntegrationValues,
} from "../../../Dist/Scripts/IntegrationTests/RuntimeIntegration/RealRuntimeIntegrationHarness.js";
import { createLanBrowserE2eHarness, expect, test } from "../browserE2eTest.mjs";

let harness;
const picture = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDWQAAAAASUVORK5CYII=",
  "base64",
);

test.beforeAll(async () => {
  await promisify(execFile)(process.execPath, ["--import", "tsx", "Build/StageMobileFrontend.ts"]);
  harness = await createLanBrowserE2eHarness({
    authenticationMode: "required",
    workspaceMode: "single-workspace",
    staticFrontendRoot: path.resolve("Frontend/.cache/mobile-web"),
  });
  await fs.writeFile(path.join(harness.workspaceRoot, "example.ts"), "export const phone = true;\n");
});

test.afterAll(async () => {
  await harness?.stop();
});

test("packaged mobile console authenticates, uploads and previews through the real LAN runtime", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 851 });
  const documents = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) documents.push(frame.url());
  });
  await login(page);
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);

  const uploadedResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/resources" && response.request().method() === "POST",
  );
  await page
    .locator('[data-chat-composer] input[type="file"]')
    .setInputFiles({ name: "phone.png", mimeType: "image/png", buffer: picture });
  const uploaded = await uploadedResponse;
  expect(uploaded.status()).toBe(200);
  const payload = await uploaded.json();
  expect(payload.resources).toHaveLength(1);
  expect(payload.resources[0]).toMatchObject({ name: "phone.png", mime: "image/png", size: picture.length });
  await sendDirectRequest(page);

  const image = page.locator('[data-message-image-source="canonical"]');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node) => node.naturalWidth)).toBeGreaterThan(0);
  await image.click();
  await expect(page.locator("[data-image-canvas-viewer]")).toBeVisible();
  const previewDrawer = page.getByRole("dialog", { name: "工作区", exact: true });
  await previewDrawer.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(previewDrawer).toBeHidden();

  await page.getByRole("button", { name: "工具", exact: true }).click();
  await page.locator("[data-workspace-menu-trigger]").click();
  await page.locator('[data-workspace-menu] [data-item-path="example.ts"]').click();
  await expect(page.locator("diffs-container")).toContainText("export const phone = true;");
  expect(documents).toEqual([`${harness.httpOrigin}/`]);
});

test("packaged composer fits every supported viewport without repeating file and message journeys", async ({
  page,
}) => {
  await login(page);
  for (const width of [390, 900, 1280, 1440, 1600]) {
    await test.step(`${width}px`, async () => {
      await page.setViewportSize({ width, height: 851 });
      const composer = page.locator("[data-chat-composer]");
      await expect(composer.getByLabel("输入消息")).toBeVisible();
      const approval = composer.getByRole("button", { name: /^(?:需要时询问|替我审批|完全访问)$/u });
      const approvalBox = await approval.boundingBox();
      expect(approvalBox).not.toBeNull();
      const model = composer.getByRole("combobox", { name: "选择模型" });
      await expect(model).toBeVisible();
      const modelBox = await model.boundingBox();
      expect(modelBox).not.toBeNull();
      expect(modelBox.x).toBeGreaterThanOrEqual(approvalBox.x + approvalBox.width);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
});

async function login(page) {
  await page.goto(harness.httpOrigin);
  await page.getByLabel("登录用户名").fill(RealRuntimeIntegrationAdmin.loginName);
  await page.getByLabel("密码", { exact: true }).fill(RealRuntimeIntegrationAdmin.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByLabel("输入消息")).toBeEnabled();
}

async function sendDirectRequest(page) {
  await page.getByLabel("输入消息").fill(RealRuntimeIntegrationValues.DirectRequestInput);
  const send = page.locator('[data-composer-action="send"]');
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.locator("[data-assistant-message]").last()).toContainText(
    RealRuntimeIntegrationValues.DirectFinalAnswer,
    {
      timeout: 30_000,
    },
  );
}
