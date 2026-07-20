import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const workspaceRoot = process.cwd();
const require = createRequire(import.meta.url);
const commitlintCliPath = require.resolve("@commitlint/cli/cli.js");
const autofixMessage = [
  "Potential fix for pull request finding 'CodeQL / Shell command built from environment values'",
  "",
  "Co-authored-by: Copilot Autofix powered by AI <62310815+github-advanced-security[bot]@users.noreply.github.com>",
].join("\n");
const autofixCoauthor = autofixMessage.split("\n")[2] ?? "";
const squashMessage = [
  "feat(frontend): merge GitHub security autofix (#27)",
  "",
  "* fix(ci): allow GitHub security autofix commits",
  "",
  "---------",
  "",
  "Co-authored-by: H1ra <w7i0817@outlook.com>",
  autofixCoauthor,
].join("\n");

assertCommitlintResult(autofixMessage, true);
assertCommitlintResult(autofixMessage.replaceAll("\n", "\r\n"), true);
assertCommitlintResult(squashMessage, true);
assertCommitlintResult(squashMessage.replaceAll("\n", "\r\n"), true);
assertCommitlintResult("fix: preserve conventional commit validation", true);
assertCommitlintResult("feat(workspace): integrate terminal configuration (#30)", true);
assertCommitlintResult("Integrate/local optimizations 20260720 (#30)", false);
assertCommitlintResult(
  `fix: preserve long URL footer compatibility\n\nRefs: https://example.com/${"x".repeat(120)}`,
  true,
);
assertCommitlintResult(autofixMessage.split("\n")[0] ?? "", false);
assertCommitlintResult(
  [
    "Potential fix supplied manually",
    "",
    "Co-authored-by: Copilot Autofix powered by AI <62310815+github-advanced-security[bot]@users.noreply.github.com>",
  ].join("\n"),
  false,
);
assertCommitlintResult(`manual change\n\n${autofixCoauthor}`, false);
assertCommitlintResult(`fix: reject unrelated long footer\n\nReviewed-by: ${"x".repeat(100)}`, false);
assertCommitlintResult(
  `fix: reject lookalike bot footer\n\n${autofixCoauthor.replace("github-advanced-security[bot]", "untrusted-security[bot]")}`,
  false,
);

console.log("Commit message policy verification passed.");

function assertCommitlintResult(message: string, expectedValid: boolean): void {
  const result = spawnSync(process.execPath, [commitlintCliPath], {
    cwd: workspaceRoot,
    encoding: "utf8",
    input: `${message}\n`,
    windowsHide: true,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.equal(
    result.status === 0,
    expectedValid,
    `Unexpected commitlint result for ${JSON.stringify(message)}:\n${output}`,
  );
}
