// @vitest-environment jsdom

import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { CodeArtifactSourceView } from "../../../Frontend/src/shared/code/CodeArtifactSourceView.tsx";

// Pierre mounts its renderer only after the shared highlighter is ready, so the
// only way to reach the fallback is a highlighter that never resolves.
vi.mock("@pierre/diffs", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getHighlighterIfLoaded: () => undefined,
    preloadHighlighter: () => Promise.reject(new Error("highlighter unavailable")),
  };
});

afterEach(cleanup);

test("keeps code readable when the highlighter cannot load", async () => {
  const { container } = render(
    React.createElement(CodeArtifactSourceView, {
      code: 'const cities = ["北京", "上海"];',
      language: "js",
    }),
  );

  await waitFor(() => expect(container.querySelector(".senera-pierre-code__fallback")).not.toBeNull(), {
    timeout: 4_000,
  });
  const fallback = container.querySelector(".senera-pierre-code__fallback");
  expect(fallback?.textContent).toContain("const cities");
  expect(fallback?.querySelectorAll("[data-line]")).toHaveLength(1);
  expect(container.querySelector("diffs-container")).toBeNull();
});
