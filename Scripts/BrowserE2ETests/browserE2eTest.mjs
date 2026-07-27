import path from "node:path";
import { expect, test as base } from "@playwright/test";
import { createRealRuntimeIntegrationHarness } from "../../Dist/Scripts/IntegrationTests/RuntimeIntegration/RealRuntimeIntegrationHarness.js";

/** @typedef {"disabled" | "required"} AuthenticationMode */

/**
 * Starts the production frontend and real runtime in one of the two supported
 * deployment authentication modes.
 *
 * @param {{ authenticationMode: AuthenticationMode }} options
 */
export function createBrowserE2eHarness({ authenticationMode }) {
  return createRealRuntimeIntegrationHarness({
    authenticationMode,
    staticFrontendRoot: path.resolve(process.cwd(), "Frontend", "dist"),
  });
}

export const test = base.extend({
  runtimeDiagnostics: [
    async ({ page }, use) => {
      const failures = [];
      page.on("pageerror", (error) => failures.push(`pageerror: ${error.stack ?? error.message}`));
      page.on("response", (response) => {
        if (response.status() >= 500) failures.push(`HTTP ${response.status()}: ${response.url()}`);
      });

      await use();

      expect(failures, failures.join("\n")).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
