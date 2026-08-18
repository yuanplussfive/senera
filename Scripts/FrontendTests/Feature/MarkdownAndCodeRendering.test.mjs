// @vitest-environment jsdom

import React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { resolveWorkspaceRoot } from "../../../Scripts/WorkspaceRoot.ts";
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
  expect(link).toHaveAttribute("data-link-kind", "external");
  expect(link).not.toHaveAttribute("title");
  expect(link.querySelector("span")).toBeNull();
  expect(link.querySelector("svg")).toHaveClass("markdown-renderer__link-icon");
  const table = screen.getByRole("table");
  expect(table).toBeInTheDocument();
  expect(table.parentElement).toHaveClass("markdown-renderer__table-wrap");
  expect(screen.getByText("ts")).toBeInTheDocument();
  expect(screen.getByText("1 lines")).toBeInTheDocument();
  expect(screen.getByText("const answer = 42;")).toBeInTheDocument();
});

test("renders chat external links as compact citation sources", async () => {
  const user = userEvent.setup();
  render(
    React.createElement(
      MarkdownRenderer,
      { externalLinkPresentation: "citation" },
      '[Project docs](https://www.example.com/docs "Project documentation")',
    ),
  );

  const link = screen.getByRole("link", { name: /^(?:查看来源：|View source: )example\.com$/u });
  expect(link).toHaveAttribute("data-link-kind", "external-citation");
  expect(link).toHaveTextContent("example.com");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).not.toHaveAttribute("title");

  await user.click(link);

  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByText("Project documentation")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /打开网页|Open website/u })).toHaveAttribute(
    "href",
    "https://www.example.com/docs",
  );
});

test("keeps markdown tables content-sized and long links line-breakable", () => {
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const css = readFileSync(path.join(workspaceRoot, "Frontend", "src", "styles", "markdown.css"), "utf8");
  const appCss = readFileSync(path.join(workspaceRoot, "Frontend", "src", "index.css"), "utf8");
  expect(css).toMatch(/\.markdown-renderer__table-wrap\s*{[^}]*width:\s*fit-content;/s);
  expect(css).toMatch(/\.markdown-renderer__table-wrap\s*{[^}]*max-width:\s*100%;/s);
  expect(css).toMatch(/\.markdown-renderer__table\s*{[^}]*width:\s*max-content;/s);
  expect(css).toMatch(/\.markdown-renderer__table\s*{[^}]*border-collapse:\s*collapse;/s);
  expect(css).toMatch(/\.markdown-renderer__table\s*{[^}]*background:\s*var\(--surface-raised\);/s);
  expect(css).not.toMatch(/\.markdown-renderer__table-wrap\s*{[^}]*border-radius:/s);
  expect(css).toMatch(/\.markdown-renderer__code-block\s*{[^}]*border-radius:\s*7px;/s);
  expect(css).toMatch(/\.markdown-renderer__code-block\s*{[^}]*width:\s*min\(100%,\s*46rem\);/s);
  expect(css).toMatch(/\.markdown-renderer__image\s*{[^}]*max-inline-size:\s*min\(100%,\s*42rem\);/s);
  expect(css).toMatch(/\.markdown-renderer__image-trigger\s*{[^}]*cursor:\s*zoom-in;/s);
  expect(css).toMatch(/\.markdown-renderer :not\(pre\) > code\s*{[^}]*color:\s*var\(--content-primary\);/s);
  expect(css).toMatch(
    /\.markdown-renderer__artifact-source\.code-artifact-viewer__source\s*{[^}]*background:\s*transparent;/s,
  );
  expect(css).toMatch(
    /\.code-artifact-viewer__highlighted\.without-line-numbers \[data-line\]::before\s*{[^}]*display:\s*none;/s,
  );
  expect(css).not.toMatch(/\.markdown-renderer__link\s*{[^}]*display:\s*inline-flex;/s);
  expect(css).toMatch(/\.markdown-renderer__link\s*{[^}]*overflow-wrap:\s*anywhere;/s);
  expect(appCss).toMatch(
    /\.assistant-turn-content\s*{[^}]*max-width:\s*min\(var\(--theme-conversation-reading-width,\s*58rem\),\s*100%\);/s,
  );
  expect(appCss).toMatch(
    /\.conversation-frame\s*{[^}]*max-width:\s*min\(var\(--theme-conversation-track-width,\s*64rem\),\s*100%\);/s,
  );
});

test("bounds markdown images and opens the shared image preview", async () => {
  const user = userEvent.setup();
  render(
    React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(MarkdownRenderer, null, "![Architecture](https://example.test/architecture.png)"),
    ),
  );

  const image = screen.getByRole("img", { name: "Architecture" });
  expect(image).toHaveAttribute("src", "https://example.test/architecture.png");
  expect(image).toHaveAttribute("loading", "lazy");
  expect(image).toHaveAttribute("decoding", "async");
  expect(image).toHaveClass("markdown-renderer__image");

  await user.click(screen.getByRole("button", { name: "查看图片：Architecture" }));

  const dialog = screen.getByRole("dialog", { name: "查看图片：Architecture" });
  expect(dialog).toHaveAttribute("data-image-preview-dialog");
  expect(within(dialog).getByRole("img", { name: "Architecture" })).toHaveAttribute(
    "src",
    "https://example.test/architecture.png",
  );
  expect(within(dialog).getByRole("button", { name: "放大" })).toBeEnabled();

  await user.click(within(dialog).getByRole("button", { name: "关闭" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "查看图片：Architecture" })).not.toBeInTheDocument());
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

test("keeps line numbers optional for compact conversation code without changing the full viewer default", async () => {
  const { container, rerender } = render(
    React.createElement(CodeArtifactSourceView, {
      code: "const answer = 42;",
      language: "ts",
      lineNumbers: false,
    }),
  );

  await waitFor(() => expect(container.querySelector(".without-line-numbers")).toBeInTheDocument());
  rerender(
    React.createElement(CodeArtifactSourceView, {
      code: "const answer = 42;",
      language: "ts",
    }),
  );
  expect(container.querySelector(".without-line-numbers")).not.toBeInTheDocument();
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
