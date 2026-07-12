// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { CodeArtifactSourceView } from "../../../Frontend/src/shared/code/CodeArtifactSourceView.tsx";
import {
  highlightCode,
  readHighlightedCode,
  resolveSupportedHighlightLanguage,
} from "../../../Frontend/src/shared/code/CodeHighlighter.ts";
import { MarkdownRenderer } from "../../../Frontend/src/shared/code/MarkdownRenderer.tsx";
import { TooltipProvider } from "../../../Frontend/src/shared/ui/Tooltip.tsx";

afterEach(cleanup);

test("renders GFM table and lightweight code while hardening external links", () => {
  render(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(
        MarkdownRenderer,
        { lightweightCode: true },
        "[Documentation](https://example.test/docs)\n\n| Key | Value |\n| --- | --- |\n| status | ready |\n\n```ts\nconst answer = 42;\n```",
      ),
    ),
  );

  const link = screen.getByRole("link", { name: /Documentation/ });
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noreferrer noopener");
  expect(screen.getByRole("table")).toBeInTheDocument();
  expect(screen.getByText("ts")).toBeInTheDocument();
  expect(screen.getByText("1 lines")).toBeInTheDocument();
  expect(screen.getByText("const answer = 42;")).toBeInTheDocument();
});

test("keeps unsupported code visible as escaped plain text instead of failing the renderer", async () => {
  const { container } = render(
    React.createElement(CodeArtifactSourceView, {
      code: "<script>window.injected = true</script>",
      language: "unsupported-language",
    }),
  );

  await waitFor(() => {
    expect(container.querySelector('[data-highlight-status="failed"]')).toBeInTheDocument();
  });
  expect(container.querySelector("script")).toBeNull();
  expect(screen.getByText("<script>window.injected = true</script>")).toBeInTheDocument();
});

test("normalizes language aliases and caches real highlighted output", async () => {
  expect(resolveSupportedHighlightLanguage("ts")).toBe("typescript");
  expect(resolveSupportedHighlightLanguage("YML")).toBe("yaml");
  expect(resolveSupportedHighlightLanguage("not-a-language")).toBeNull();

  const request = { language: "ts", code: "const answer = 42;" };
  const highlighted = highlightCode(request);
  await expect(highlighted).resolves.toContain("data-line");
  expect(readHighlightedCode(request)).toBe(highlighted);
  await expect(highlightCode({ language: "not-a-language", code: "value" })).rejects.toThrow(
    "Unsupported code language",
  );
});
