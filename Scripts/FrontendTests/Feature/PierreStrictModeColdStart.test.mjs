// @vitest-environment jsdom

import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { PierreFilePreview } from "../../../Frontend/src/shared/code/PierreCodeView.tsx";

const Code = 'const cities = ["北京", "上海"];\nconst results = await Promise.allSettled([]);';

afterEach(cleanup);

// Regression: Pierre's shared highlighter starts cold in this file. Mounting
// the renderer while it is still loading leaves the Shadow DOM empty forever
// because React StrictMode repeats effects and the async highlight lands on a
// discarded instance. The preview must wait for the highlighter instead.
test("strict mode cold start renders highlighted code", async () => {
  const { container } = render(
    React.createElement(
      React.StrictMode,
      null,
      React.createElement(PierreFilePreview, { code: Code, language: "js", lineNumbers: false }),
    ),
  );

  expect(container.querySelector(".senera-pierre-code__fallback")?.textContent).toContain("const cities");

  await waitFor(
    () => {
      const shadowText = container.querySelector("diffs-container")?.shadowRoot?.textContent ?? "";
      expect(shadowText).toContain("const cities");
    },
    { timeout: 6_000 },
  );
});
