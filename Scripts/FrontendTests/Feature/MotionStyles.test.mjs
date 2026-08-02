import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const transitionsCssPath = [
  resolve(process.cwd(), "Frontend/src/styles/transitions.css"),
  resolve(process.cwd(), "src/styles/transitions.css"),
].find((candidate) => existsSync(candidate));

if (!transitionsCssPath) {
  throw new Error("Unable to locate Frontend/src/styles/transitions.css");
}

const transitionsCss = readFileSync(transitionsCssPath, "utf8");

describe("shared motion styles", () => {
  it("uses responsive easing for the menu exit", () => {
    expect(transitionsCss).toMatch(
      /\.menu-surface\[data-state="closed"\]\s*{\s*animation:\s*menu-surface-out 90ms cubic-bezier\(0\.22, 1, 0\.36, 1\) both;/,
    );
  });

  it("keeps reduced menu feedback while reserving instant motion for none", () => {
    expect(transitionsCss).toMatch(
      /html\[data-motion-level="reduced"\] \.menu-surface\[data-state="open"\][\s\S]*?animation-name:\s*menu-surface-fade-in;[\s\S]*?animation-duration:\s*120ms;/,
    );
    expect(transitionsCss).toMatch(
      /html\[data-motion-level="reduced"\] \.menu-surface\[data-state="closed"\][\s\S]*?animation-name:\s*menu-surface-fade-out;[\s\S]*?animation-duration:\s*90ms;/,
    );
    expect(transitionsCss).toMatch(
      /html\[data-motion-level="none"\] \.menu-surface\[data-state\]\s*{\s*animation-duration:\s*0\.001ms !important;/,
    );
  });
});
