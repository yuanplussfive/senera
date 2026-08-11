import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { resolveWorkspaceRoot } from "../../../Scripts/WorkspaceRoot.ts";

const transitionsCss = readFileSync(
  path.join(resolveWorkspaceRoot(process.cwd()), "Frontend", "src", "styles", "transitions.css"),
  "utf8",
);

describe("shared motion styles", () => {
  test("keeps Radix transform origins and shared timing tokens", () => {
    expect(transitionsCss).toContain("var(--radix-dropdown-menu-content-transform-origin)");
    expect(transitionsCss).toContain("var(--radix-context-menu-content-transform-origin)");
    expect(transitionsCss).toContain("var(--menu-open-dur)");
    expect(transitionsCss).toContain("var(--menu-close-dur)");
  });

  test("keeps reduced menu feedback while reserving instant motion for none", () => {
    expect(transitionsCss).toMatch(
      /html\[data-motion-level="reduced"\] \.menu-surface\[data-state="open"\][\s\S]*?animation-name: menu-surface-fade-in;/,
    );
    expect(transitionsCss).toMatch(
      /html\[data-motion-level="none"\] \.menu-surface\[data-state\][\s\S]*?animation-duration: 0\.001ms !important;/,
    );
  });

  test("prevents closed overlays from intercepting input and animates persistent menu checks", () => {
    expect(transitionsCss).toMatch(/\.dialog-presence\[data-state="closed"\][\s\S]*?pointer-events: none !important;/);
    expect(transitionsCss).toContain('[data-state="checked"] .menu-check');
  });
});
