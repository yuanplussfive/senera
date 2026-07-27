import { defineConfig, devices } from "@playwright/test";

const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./Scripts/BrowserE2ETests",
  testMatch: "**/*.spec.mjs",
  outputDir: ".cache/playwright-results",
  fullyParallel: false,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  workers: 1,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  reporter: isCi ? [["line"], ["html", { open: "never", outputFolder: ".cache/playwright-report" }]] : [["list"]],
  use: {
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      testMatch: "**/WebJourney/*.spec.mjs",
      use: {
        ...devices["Desktop Chrome"],
        colorScheme: "light",
        locale: "zh-CN",
      },
    },
    {
      name: "electron",
      testMatch: "**/DesktopJourney/*.spec.mjs",
    },
  ],
});
